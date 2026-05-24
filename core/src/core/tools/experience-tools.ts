import * as os from "node:os";
import * as path from "node:path";
import {
  FileSystemExperienceCandidateStore,
  type ExperienceApprovalStatus,
  type ExperienceCandidate,
  type ExperienceCandidateFilter,
  type ExperienceKind,
} from "../experience";
import type { ToolAuditRecord } from "./tool-audit";
import { FileSystemToolAuditStore } from "./tool-audit";
import type { RegisteredTool } from "./registry";
import { toolResultString } from "./tool-result";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ExperienceToolOptions {
  dataDir: string;
  projectRoot?: string;
  auditStore?: FileSystemToolAuditStore;
  candidateStore?: FileSystemExperienceCandidateStore;
}

interface ParsedToolResult {
  success?: boolean;
  data?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: { name?: string; message?: string };
}

export function createExperienceTools(options: ExperienceToolOptions): RegisteredTool[] {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const auditStore = options.auditStore ?? new FileSystemToolAuditStore(options.dataDir);
  const candidateStore = options.candidateStore ?? new FileSystemExperienceCandidateStore(options.dataDir);
  auditStore.init();
  candidateStore.init();

  return [
    {
      name: "list_tool_runs",
      description:
        "List recent audited tool runs. Use this before turning tool evidence into an experience candidate for subagents, skills, or tool runtimes.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum records, capped at 100." },
          date_key: { type: "string", description: "Optional YYYY-MM-DD audit date." },
          tool_name: { type: "string", description: "Optional tool name filter." },
        },
      },
      risk: "read",
      scopes: ["experience", "shell", "project"],
      handler: async (_name, args) => {
        const records = await auditStore.list({
          limit: clampLimit(args.limit),
          dateKey: stringArg(args.date_key),
          toolName: stringArg(args.tool_name),
        });
        return toolResultString({
          success: true,
          data: records.map(summarizeAuditRecord),
          latencyMs: 0,
        });
      },
    },
    {
      name: "propose_experience_from_tool_run",
      description:
        "Create a scoped tool experience candidate from an audited tool run. The candidate remains untrusted until the user approves it.",
      parameters: {
        type: "object",
        properties: {
          tool_run_id: { type: "string", description: "Tool audit record id." },
          kind: {
            type: "string",
            enum: ["tool_behavior", "tool_failure_pattern", "verification_pattern", "workflow_pattern"],
            description: "Optional candidate kind. Defaults to a heuristic.",
          },
          claim: { type: "string", description: "Optional explicit claim to propose." },
          confidence: { type: "number", description: "Optional confidence from 0 to 1." },
          expires_at: { type: "number", description: "Optional unix milliseconds expiry." },
        },
        required: ["tool_run_id"],
      },
      risk: "write",
      scopes: ["experience", "shell", "project"],
      handler: async (_name, args) => {
        const toolRunId = stringArg(args.tool_run_id);
        if (!toolRunId) {
          return toolResultString({
            success: false,
            error: { name: "InvalidArguments", message: "tool_run_id is required" },
            latencyMs: 0,
          });
        }

        const record = await auditStore.get(toolRunId);
        if (!record) {
          return toolResultString({
            success: false,
            error: { name: "ToolRunNotFound", message: `tool run not found: ${toolRunId}` },
            latencyMs: 0,
          });
        }

        const proposal = buildExperienceProposal(record, projectRoot, {
          kind: parseKind(args.kind),
          claim: stringArg(args.claim),
          confidence: numberArg(args.confidence),
          expiresAt: numberArg(args.expires_at),
        });
        const candidate = await candidateStore.create(proposal);
        return toolResultString({
          success: true,
          data: candidate,
          latencyMs: 0,
        });
      },
    },
    {
      name: "list_experience_candidates",
      description: "List scoped tool experience candidates and approved experiences for subagents, skills, and tool runtimes.",
      parameters: {
        type: "object",
        properties: {
          approval_status: {
            type: "string",
            enum: ["candidate", "approved", "rejected", "superseded"],
          },
          kind: {
            type: "string",
            enum: ["tool_behavior", "tool_failure_pattern", "verification_pattern", "workflow_pattern"],
          },
          tool_name: { type: "string" },
          limit: { type: "number", description: "Maximum records, capped at 100." },
        },
      },
      risk: "read",
      scopes: ["experience", "shell", "project"],
      handler: async (_name, args) => {
        const filter: ExperienceCandidateFilter = {
          approvalStatus: parseStatus(args.approval_status),
          kind: parseKind(args.kind),
          toolName: stringArg(args.tool_name),
          limit: clampLimit(args.limit),
        };
        const candidates = await candidateStore.list(filter);
        return toolResultString({
          success: true,
          data: candidates,
          latencyMs: 0,
        });
      },
    },
    {
      name: "review_experience_candidate",
      description:
        "Approve, reject, or supersede an experience candidate after user confirmation or newer evidence.",
      parameters: {
        type: "object",
        properties: {
          candidate_id: { type: "string" },
          approval_status: {
            type: "string",
            enum: ["approved", "rejected", "superseded"],
          },
          review_note: { type: "string" },
          superseded_by: { type: "string" },
        },
        required: ["candidate_id", "approval_status"],
      },
      risk: "write",
      scopes: ["experience", "shell", "project"],
      handler: async (_name, args) => {
        const candidateId = stringArg(args.candidate_id);
        const status = parseReviewStatus(args.approval_status);
        if (!candidateId || !status) {
          return toolResultString({
            success: false,
            error: { name: "InvalidArguments", message: "candidate_id and valid approval_status are required" },
            latencyMs: 0,
          });
        }

        const updated = await candidateStore.updateStatus(candidateId, status, {
          reviewNote: stringArg(args.review_note),
          supersededBy: stringArg(args.superseded_by),
        });
        if (!updated) {
          return toolResultString({
            success: false,
            error: { name: "ExperienceCandidateNotFound", message: `candidate not found: ${candidateId}` },
            latencyMs: 0,
          });
        }
        return toolResultString({ success: true, data: updated, latencyMs: 0 });
      },
    },
  ];
}

function buildExperienceProposal(
  record: ToolAuditRecord,
  projectRoot: string,
  overrides: {
    kind?: ExperienceKind;
    claim?: string;
    confidence?: number;
    expiresAt?: number;
  },
): Omit<ExperienceCandidate, "id" | "createdAt" | "updatedAt" | "approvalStatus"> {
  const result = parseToolResult(record.resultPreview);
  const kind = overrides.kind ?? inferKind(record, result);
  const success = record.success && result.success !== false;
  const claim = overrides.claim ?? inferClaim(record, result, success);
  const confidence = clampConfidence(overrides.confidence ?? inferConfidence(record, result, success));

  return {
    kind,
    scope: {
      hostId: os.hostname(),
      projectRoot,
      capabilityName: inferCapabilityName(record.toolName),
      toolName: record.toolName,
      agentType: record.agentType,
    },
    claim,
    evidenceRefs: [`tool-run:${record.id}`],
    confidence,
    lastVerifiedAt: record.timestamp,
    expiresAt: overrides.expiresAt,
    metadata: {
      toolName: record.toolName,
      success: record.success,
      exitCode: result.exitCode,
      sessionId: record.sessionId,
      taskId: record.taskId,
      runId: record.runId,
      verifier: buildVerifierSummary(record, result),
    },
  };
}

function inferKind(record: ToolAuditRecord, result: ParsedToolResult): ExperienceKind {
  const command = extractCommand(result).toLowerCase();
  if (record.toolName === "run_typecheck" || record.toolName === "run_tests" || record.toolName === "run_lint") {
    return "verification_pattern";
  }
  if (record.success === false || result.success === false || result.exitCode !== 0) {
    return "tool_failure_pattern";
  }
  if (/(install|build|compile|test|lint|typecheck|serve|start|clone|fetch|push|pull)/i.test(command)) {
    return "workflow_pattern";
  }
  return "tool_behavior";
}

function inferClaim(record: ToolAuditRecord, result: ParsedToolResult, success: boolean): string {
  const command = extractCommand(result);
  if (record.toolName === "run_typecheck") {
    return success
      ? "当前项目的 TypeScript 类型检查可以通过默认 typecheck 流程验证。"
      : "当前项目的 TypeScript 类型检查未通过，需要查看编译器输出后再继续。";
  }
  if (record.toolName === "run_tests") {
    return success
      ? "当前项目的测试可以通过默认 test 脚本验证。"
      : "当前项目的默认 test 脚本未通过，需要依据测试输出诊断。";
  }
  if (record.toolName === "run_lint") {
    return success
      ? "当前项目的 lint 可以通过默认 lint 脚本验证。"
      : "当前项目的默认 lint 脚本未通过，需要依据 lint 输出诊断。";
  }
  if (record.toolName.startsWith("git_")) {
    return success
      ? `工具 ${record.toolName} 在当前 scope 下执行成功，可作为该工具行为证据。`
      : `工具 ${record.toolName} 在当前 scope 下执行失败，需要结合 stderr、exitCode 和 verifier 结果诊断。`;
  }
  if (command) {
    return success
      ? `命令 "${command}" 在当前项目环境中执行成功。`
      : `命令 "${command}" 在当前项目环境中执行失败，后续复用前应先检查失败原因。`;
  }
  return success
    ? `工具 ${record.toolName} 在当前环境中执行成功。`
    : `工具 ${record.toolName} 在当前环境中执行失败，后续复用前应先检查失败原因。`;
}

function inferConfidence(record: ToolAuditRecord, result: ParsedToolResult, success: boolean): number {
  if (!success) return 0.55;
  if (record.toolName === "run_typecheck" || record.toolName === "run_tests" || record.toolName === "run_lint") return 0.75;
  if (record.toolName.startsWith("git_")) return 0.7;
  if (result.exitCode === 0) return 0.65;
  return 0.6;
}

function inferCapabilityName(toolName: string): string | undefined {
  if (toolName.startsWith("git_")) return "git";
  if (toolName === "run_typecheck" || toolName === "run_tests" || toolName === "run_lint") return "node";
  if (toolName === "run_shell_command") return "shell";
  if (toolName.startsWith("browser_")) return "browser";
  if (toolName.startsWith("web_")) return "network";
  return undefined;
}

function buildVerifierSummary(record: ToolAuditRecord, result: ParsedToolResult): Record<string, unknown> {
  return {
    auditSuccess: record.success,
    resultSuccess: result.success,
    exitCode: result.exitCode,
    errorName: result.error?.name,
    errorMessage: result.error?.message,
    hasStdout: Boolean(result.stdout),
    hasStderr: Boolean(result.stderr),
  };
}

function summarizeAuditRecord(record: ToolAuditRecord): Record<string, unknown> {
  const result = parseToolResult(record.resultPreview);
  return {
    id: record.id,
    timestamp: record.timestamp,
    toolName: record.toolName,
    risk: record.risk,
    scopes: record.scopes,
    success: record.success,
    latencyMs: record.latencyMs,
    command: extractCommand(result),
    exitCode: result.exitCode,
    error: record.error ?? result.error,
    sessionId: record.sessionId,
    taskId: record.taskId,
    runId: record.runId,
    agentType: record.agentType,
  };
}

function parseToolResult(preview: string): ParsedToolResult {
  try {
    const parsed = JSON.parse(preview) as ParsedToolResult;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return parseTruncatedToolResult(preview);
  }
}

function parseTruncatedToolResult(preview: string): ParsedToolResult {
  const result: ParsedToolResult = {};
  const success = preview.match(/"success"\s*:\s*(true|false)/);
  if (success) result.success = success[1] === "true";

  const exitCode = preview.match(/"exitCode"\s*:\s*(-?\d+|null)/);
  if (exitCode) result.exitCode = exitCode[1] === "null" ? null : Number(exitCode[1]);

  const command = preview.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (command) {
    result.data = { command: unescapeJsonString(command[1]) };
  }

  const stderr = preview.match(/"stderr"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (stderr) result.stderr = unescapeJsonString(stderr[1]);

  return result;
}

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function extractCommand(result: ParsedToolResult): string {
  const data = result.data;
  if (data && typeof data === "object" && typeof (data as { command?: unknown }).command === "string") {
    return (data as { command: string }).command;
  }
  return "";
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clampLimit(value: unknown): number {
  const n = numberArg(value);
  if (!n) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseKind(value: unknown): ExperienceKind | undefined {
  return value === "tool_behavior" ||
    value === "tool_failure_pattern" ||
    value === "verification_pattern" ||
    value === "workflow_pattern"
    ? value
    : undefined;
}

function parseStatus(value: unknown): ExperienceApprovalStatus | undefined {
  return value === "candidate" || value === "approved" || value === "rejected" || value === "superseded"
    ? value
    : undefined;
}

function parseReviewStatus(value: unknown): Exclude<ExperienceApprovalStatus, "candidate"> | undefined {
  return value === "approved" || value === "rejected" || value === "superseded"
    ? value
    : undefined;
}
