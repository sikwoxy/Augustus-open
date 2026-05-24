import { exec, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { serializeError } from "../../utils/diagnostics";
import { FileSystemExperienceCandidateStore } from "../experience";
import { loadLatestPrior } from "../environment";
import type { RegisteredTool } from "./registry";
import { toolResultString, type ToolResultV1 } from "./tool-result";
import type { ToolRuntimeContext } from "./tool-context";
import type {
  TaskVerificationRecord,
  VerificationCheckKey,
  VerificationStatus,
  WorkspacePermission,
} from "../task/types";
import {
  isInside,
  normalizeProjectRoot,
  resolveWorkspaceRootForPermission,
} from "./workspace-policy";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 24_000;
const MAX_COMMAND_CHARS = 8000;

interface ProcessResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

async function getCurrentTaskId(context: ToolRuntimeContext): Promise<string | null> {
  const current = context.getCurrentContext?.();
  if (!current || !context.taskStore) return null;
  const pointer = await context.taskStore.getCurrentPointer(
    current.userId,
    current.channel,
    current.conversationId,
  );
  return pointer?.taskId ?? null;
}

async function resolveCommandRootForPermission(
  context: ToolRuntimeContext,
  permission: WorkspacePermission,
): Promise<string> {
  return resolveWorkspaceRootForPermission(context, permission);
}

function resolveCwd(projectRoot: string, input?: unknown): string {
  const root = normalizeProjectRoot(projectRoot);
  const raw = typeof input === "string" && input.trim() ? input.trim() : ".";
  const resolved = path.resolve(root, raw);
  if (!isInside(root, resolved)) {
    throw new Error("cwd escapes project root");
  }
  return resolved;
}

function clampTimeout(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(MAX_TIMEOUT_MS, Math.floor(n)));
}

function validateShellCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "command is required";
  if (trimmed.length > MAX_COMMAND_CHARS) return `command is too long; max ${MAX_COMMAND_CHARS} characters`;
  const denied = [
    /\brm\s+-[^\n]*\brf\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\b/i,
    /\bdel\s+\/[sq]\b/i,
    /\brmdir\s+\/[sq]\b/i,
    /\bRemove-Item\b[^\n]*(?:-Recurse|-r)\b/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bStart-Process\b/i,
    /\bnohup\b/i,
    /\b(printenv|env)\b/i,
    /\b(Get-ChildItem|gci|dir)\s+Env:/i,
    /\$env:/i,
    /(^|[\s"'`])(?:[A-Za-z]:\\|\\\\|\/(?:app|bin|boot|dev|etc|home|mnt|opt|proc|root|run|srv|sys|tmp|usr|var)\b)/i,
    /(^|[\s"'`])~[\\/]/,
    /(^|[\s"'`])\.\.[\\/]/,
    /\.(?:env|pem|key|p12|pfx)\b/i,
    /[<>]/,
  ];
  return denied.some((pattern) => pattern.test(trimmed)) ? "command rejected by shell safety policy" : null;
}

function buildEnv(extra: unknown): NodeJS.ProcessEnv {
  const allowedBase = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ComSpec",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedBase) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
      if (!/^(NODE_ENV|CI|FORCE_COLOR|NO_COLOR|npm_config_[A-Za-z0-9_-]+)$/.test(key)) continue;
      if (typeof value === "string") env[key] = value;
    }
  }
  return env;
}

function trimOutput(stdout: string, stderr: string): { stdout: string; stderr: string; truncated: boolean } {
  let truncated = false;
  const trim = (text: string) => {
    if (Buffer.byteLength(text, "utf-8") <= OUTPUT_LIMIT) return text;
    truncated = true;
    return `${text.slice(0, OUTPUT_LIMIT)}\n... truncated ...`;
  };
  return { stdout: trim(stdout), stderr: trim(stderr), truncated };
}

async function runShell(args: Record<string, unknown>, projectRoot: string): Promise<string> {
  const command = typeof args.command === "string" ? args.command : "";
  const policyError = validateShellCommand(command);
  if (policyError) {
    return toolResultString({
      success: false,
      error: { name: "ToolPolicyError", message: policyError },
      latencyMs: 0,
    });
  }

  const cwd = resolveCwd(projectRoot, args.cwd);
  const timeoutMs = clampTimeout(args.timeoutMs);
  const startedAt = Date.now();

  const result = await execCommand(command, cwd, timeoutMs, buildEnv(args.env));
  return toolResultString({
    success: result.exitCode === 0 && !result.timedOut,
    data: result,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    latencyMs: Date.now() - startedAt,
    error: result.exitCode === 0 && !result.timedOut
      ? undefined
      : { name: "CommandFailed", message: result.timedOut ? "command timed out" : `exit code ${result.exitCode}` },
  });
}

function execCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: OUTPUT_LIMIT * 4, env, windowsHide: true }, (error, stdout, stderr) => {
      const err = error as (Error & { code?: number | string; killed?: boolean }) | null;
      const output = trimOutput(stdout ?? "", stderr ?? "");
      resolve({
        command,
        cwd,
        exitCode: !err ? 0 : typeof err.code === "number" ? err.code : null,
        stdout: output.stdout,
        stderr: output.stderr,
        timedOut: Boolean(err?.killed),
        truncated: output.truncated,
      });
    });
  });
}

function execFileCommand(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: OUTPUT_LIMIT * 4, env: buildEnv(undefined), windowsHide: true }, (error, stdout, stderr) => {
      const err = error as (Error & { code?: number | string; killed?: boolean }) | null;
      const output = trimOutput(stdout ?? "", stderr ?? "");
      resolve({
        command: [file, ...args].join(" "),
        cwd,
        exitCode: !err ? 0 : typeof err.code === "number" ? err.code : null,
        stdout: output.stdout,
        stderr: output.stderr,
        timedOut: Boolean(err?.killed),
        truncated: output.truncated,
      });
    });
  });
}

async function gitTool(args: string[], projectRoot: string): Promise<string> {
  const cwd = normalizeProjectRoot(projectRoot);
  const startedAt = Date.now();
  const result = await execFileCommand("git", args, cwd, DEFAULT_TIMEOUT_MS);
  return toolResultString({
    success: result.exitCode === 0,
    data: result,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    latencyMs: Date.now() - startedAt,
    error: result.exitCode === 0 ? undefined : { name: "GitCommandFailed", message: `exit code ${result.exitCode}` },
  });
}

async function recordVerification(
  context: ToolRuntimeContext,
  input: {
    key: VerificationCheckKey;
    label: string;
    toolName: string;
    resultText: string;
  },
): Promise<void> {
  if (!context.taskStore) return;
  const taskId = await getCurrentTaskId(context);
  if (!taskId) return;
  const task = await context.taskStore.getTask(taskId);
  if (!task) return;

  const parsed = parseToolResult(input.resultText);
  const status = toVerificationStatus(parsed);
  const record: TaskVerificationRecord = {
    key: input.key,
    label: input.label,
    status,
    verifiedAt: Date.now(),
    toolName: input.toolName,
    command: extractCommand(parsed),
    summary: summarizeVerification(input.label, status, parsed),
    details: {
      exitCode: parsed?.exitCode,
      truncated: parsed?.truncated,
      error: parsed?.error,
      stdoutPreview: preview(parsed?.stdout ?? "", 500),
      stderrPreview: preview(parsed?.stderr ?? "", 500),
    },
  };

  const existing = task.verificationState?.records ?? [];
  task.verificationState = {
    updatedAt: Date.now(),
    records: [
      ...existing.filter((item) => item.key !== input.key),
      record,
    ],
    notes: task.verificationState?.notes,
  };
  await context.taskStore.saveTask(task);
}

function parseToolResult(resultText: string): ToolResultV1<unknown> | null {
  try {
    return JSON.parse(resultText) as ToolResultV1<unknown>;
  } catch {
    return null;
  }
}

function toVerificationStatus(result: ToolResultV1<unknown> | null): VerificationStatus {
  if (!result) return "unknown";
  if (result.success) return "passed";
  const errorName = result.error?.name ?? "";
  if (
    errorName === "MissingScript" ||
    errorName === "MissingProjectConfig" ||
    errorName === "ToolPolicyError" ||
    errorName.includes("WorkspaceGrant")
  ) {
    return "blocked";
  }
  return "failed";
}

function summarizeVerification(
  label: string,
  status: VerificationStatus,
  result: ToolResultV1<unknown> | null,
): string {
  if (!result) return `${label}: unknown result`;
  if (status === "passed") return `${label}: passed`;
  const message = result.error?.message ? ` (${result.error.message})` : "";
  return `${label}: ${status}${message}`;
}

function extractCommand(result: ToolResultV1<unknown> | null): string | undefined {
  const data = result?.data as { command?: unknown } | undefined;
  return typeof data?.command === "string" ? data.command : undefined;
}

async function packageScriptTool(kind: "typecheck" | "tests" | "lint", projectRoot: string): Promise<string> {
  const cwd = normalizeProjectRoot(projectRoot);
  const packageJson = path.join(cwd, "package.json");
  const tsconfig = path.join(cwd, "tsconfig.json");
  const startedAt = Date.now();
  const scripts = await readPackageScripts(packageJson);
  let command: string;

  if (kind === "typecheck") {
    if (!fs.existsSync(packageJson) && !fs.existsSync(tsconfig)) {
      return toolResultString({
        success: false,
        error: { name: "MissingProjectConfig", message: "no package.json or tsconfig.json found" },
        latencyMs: Date.now() - startedAt,
      });
    }
    command = scripts.typecheck ? "npm run typecheck" : "npm exec tsc -- --noEmit";
  } else if (kind === "tests") {
    if (!scripts.test) {
      return toolResultString({
        success: false,
        error: { name: "MissingScript", message: "package.json has no test script" },
        latencyMs: Date.now() - startedAt,
      });
    }
    command = "npm test";
  } else {
    if (!scripts.lint) {
      return toolResultString({
        success: false,
        error: { name: "MissingScript", message: "package.json has no lint script" },
        latencyMs: Date.now() - startedAt,
      });
    }
    command = "npm run lint";
  }

  const result = await execCommand(command, cwd, MAX_TIMEOUT_MS, buildEnv(undefined));
  return toolResultString({
    success: result.exitCode === 0,
    data: result,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    latencyMs: Date.now() - startedAt,
    error: result.exitCode === 0 ? undefined : { name: "VerificationFailed", message: `exit code ${result.exitCode}` },
  });
}

async function buildRuntimeWarnings(context: ToolRuntimeContext, toolName: string): Promise<string[]> {
  const warnings: string[] = [];
  const prior = loadLatestPrior(context.projectRoot);
  if (prior?.summaries.shellSummary) {
    warnings.push(`shellSummary: ${preview(prior.summaries.shellSummary, 500)}`);
  }

  const store = new FileSystemExperienceCandidateStore(context.dataDir);
  const approved = await store.list({ approvalStatus: "approved", toolName, limit: 5 }).catch(() => []);
  for (const item of approved) {
    warnings.push(`approvedExperience: ${preview(item.claim, 300)}`);
  }
  return warnings;
}

function mergeWarnings(resultText: string, warnings: string[]): string {
  if (warnings.length === 0) return resultText;
  try {
    const parsed = JSON.parse(resultText) as { warnings?: unknown };
    const existing = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string")
      : [];
    parsed.warnings = [...existing, ...warnings];
    return JSON.stringify(parsed);
  } catch {
    return resultText;
  }
}

async function readPackageScripts(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function safeRef(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!/^[A-Za-z0-9._/@:-]+$/.test(raw)) return fallback;
  return raw;
}

function safeCount(value: unknown, fallback: number, max: number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.max(1, Math.min(max, Math.floor(n))));
}

export function createCommandTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "run_shell_command",
      description:
        "Run a bounded shell command inside the project root. Uses timeout, output truncation, env allowlist, cwd containment, and destructive-command rejection.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
          cwd: { type: "string", description: "Project-relative working directory; defaults to project root." },
          timeoutMs: { type: "number", description: "Timeout in milliseconds, capped at 120000." },
          env: { type: "object", description: "Optional allowlisted env vars such as NODE_ENV or CI." },
        },
        required: ["command"],
      },
      risk: "execute",
      scopes: ["shell", "project"],
      timeoutMs: MAX_TIMEOUT_MS,
      outputLimitBytes: OUTPUT_LIMIT,
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "execute");
          const result = await runShell(args, projectRoot);
          return mergeWarnings(result, await buildRuntimeWarnings(context, "run_shell_command"));
        } catch (err) {
          return toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
        }
      },
    },
    {
      name: "git_status",
      description: "Run git status --short --branch inside the project root.",
      parameters: { type: "object", properties: {} },
      risk: "read",
      scopes: ["git", "project"],
      handler: async () => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "read");
          return gitTool(["status", "--short", "--branch"], projectRoot);
        } catch (err) {
          return toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
        }
      },
    },
    {
      name: "git_diff",
      description: "Show git diff. Supports optional staged=true.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged diff instead of working tree diff." },
        },
      },
      risk: "read",
      scopes: ["git", "project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "read");
          const result = await gitTool(args.staged === true ? ["diff", "--staged"] : ["diff"], projectRoot);
          await recordVerification(context, {
            key: "git_diff_checked",
            label: args.staged === true ? "git staged diff checked" : "git diff checked",
            toolName: "git_diff",
            resultText: result,
          });
          return result;
        } catch (err) {
          const result = toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
          await recordVerification(context, {
            key: "git_diff_checked",
            label: "git diff checked",
            toolName: "git_diff",
            resultText: result,
          });
          return result;
        }
      },
    },
    {
      name: "git_log",
      description: "Show recent git commits with one-line summaries.",
      parameters: {
        type: "object",
        properties: {
          max_count: { type: "number", description: "Maximum commits, capped at 50." },
        },
      },
      risk: "read",
      scopes: ["git", "project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "read");
          return gitTool(["log", "--oneline", "--decorate", `-${safeCount(args.max_count, 20, 50)}`], projectRoot);
        } catch (err) {
          return toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
        }
      },
    },
    {
      name: "git_show",
      description: "Show a git object or commit. Ref is sanitized and defaults to HEAD.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Git ref or object to show; defaults to HEAD." },
        },
      },
      risk: "read",
      scopes: ["git", "project"],
      handler: async (_name, args) => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "read");
          return gitTool(["show", "--stat", "--patch", safeRef(args.ref, "HEAD")], projectRoot);
        } catch (err) {
          return toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
        }
      },
    },
    {
      name: "run_typecheck",
      description: "Run package type checking. Uses npm run typecheck when present, otherwise npm exec tsc -- --noEmit.",
      parameters: { type: "object", properties: {} },
      risk: "execute",
      scopes: ["shell", "project"],
      timeoutMs: MAX_TIMEOUT_MS,
      handler: async () => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "execute");
          const result = mergeWarnings(
            await packageScriptTool("typecheck", projectRoot),
            await buildRuntimeWarnings(context, "run_typecheck"),
          );
          await recordVerification(context, {
            key: "typecheck_passed",
            label: "typecheck",
            toolName: "run_typecheck",
            resultText: result,
          });
          return result;
        } catch (err) {
          const result = toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
          await recordVerification(context, {
            key: "typecheck_passed",
            label: "typecheck",
            toolName: "run_typecheck",
            resultText: result,
          });
          return result;
        }
      },
    },
    {
      name: "run_tests",
      description: "Run npm test when a test script exists.",
      parameters: { type: "object", properties: {} },
      risk: "execute",
      scopes: ["shell", "project"],
      timeoutMs: MAX_TIMEOUT_MS,
      handler: async () => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "execute");
          const result = mergeWarnings(
            await packageScriptTool("tests", projectRoot),
            await buildRuntimeWarnings(context, "run_tests"),
          );
          await recordVerification(context, {
            key: "tests_passed",
            label: "tests",
            toolName: "run_tests",
            resultText: result,
          });
          return result;
        } catch (err) {
          const result = toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
          await recordVerification(context, {
            key: "tests_passed",
            label: "tests",
            toolName: "run_tests",
            resultText: result,
          });
          return result;
        }
      },
    },
    {
      name: "run_lint",
      description: "Run npm run lint when a lint script exists.",
      parameters: { type: "object", properties: {} },
      risk: "execute",
      scopes: ["shell", "project"],
      timeoutMs: MAX_TIMEOUT_MS,
      handler: async () => {
        try {
          const projectRoot = await resolveCommandRootForPermission(context, "execute");
          const result = mergeWarnings(
            await packageScriptTool("lint", projectRoot),
            await buildRuntimeWarnings(context, "run_lint"),
          );
          await recordVerification(context, {
            key: "lint_passed",
            label: "lint",
            toolName: "run_lint",
            resultText: result,
          });
          return result;
        } catch (err) {
          const result = toolResultString({ success: false, error: serializeError(err), latencyMs: 0 });
          await recordVerification(context, {
            key: "lint_passed",
            label: "lint",
            toolName: "run_lint",
            resultText: result,
          });
          return result;
        }
      },
    },
  ];
}

function preview(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}
