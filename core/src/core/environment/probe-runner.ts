import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import type { CapabilityProbe, CapabilityProbeCategory } from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 15000;
const MAX_PREVIEW_BYTES = 2000;

function clampTimeout(ms?: number): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(MAX_TIMEOUT_MS, Math.floor(ms)));
}

function truncatePreview(text: string): string {
  if (Buffer.byteLength(text, "utf-8") <= MAX_PREVIEW_BYTES) return text;
  return text.slice(0, MAX_PREVIEW_BYTES) + "...";
}

function extractVersion(stdout: string, stderr: string): string | undefined {
  const combined = (stdout + stderr).trim();
  if (!combined) return undefined;
  const firstLine = combined.split("\n")[0].trim();
  const match = firstLine.match(/v?(\d+\.\d+\.\d+)/);
  if (match) return match[1];
  const altMatch = firstLine.match(/(\d+\.\d+)/);
  return altMatch ? altMatch[1] : firstLine.slice(0, 100);
}

function statusFromVersionResult(result: ProbeExecResult): {
  status: CapabilityProbe["status"];
  confidence: number;
} {
  if (result.exitCode === 0) {
    return { status: "available", confidence: 0.95 };
  }

  if (result.timedOut) {
    return { status: "uncertain", confidence: 0.4 };
  }

  return { status: "unavailable", confidence: 0.75 };
}

export interface ProbeExecResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

async function execWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProbeExecResult> {
  const fullCmd = [command, ...args].join(" ");
  const actual = buildPlatformCommand(command, args);
  try {
    const { stdout, stderr } = await execFileAsync(actual.command, actual.args, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return {
      command: fullCmd,
      exitCode: 0,
      stdout: truncatePreview(stdout),
      stderr: truncatePreview(stderr),
      timedOut: false,
    };
  } catch (err) {
    const error = err as Error & {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    return {
      command: fullCmd,
      exitCode: typeof error.code === "number" ? error.code : null,
      stdout: truncatePreview(error.stdout ?? ""),
      stderr: truncatePreview(error.stderr ?? ""),
      timedOut: Boolean(error.killed),
      error: error.message,
    };
  }
}

function buildPlatformCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (os.platform() !== "win32") return { command, args };

  if (/\.(cmd|bat)$/i.test(command)) {
    return {
      command: "cmd",
      args: ["/d", "/s", "/c", [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(" ")],
    };
  }

  if (/\.ps1$/i.test(command)) {
    return {
      command: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
    };
  }

  return { command, args };
}

function quoteCmdArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function preferWindowsExecutable(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const preferredExts = [".exe", ".cmd", ".bat", ".ps1"];
  for (const ext of preferredExts) {
    const found = paths.find((item) => item.toLowerCase().endsWith(ext));
    if (found) return found;
  }
  return paths[0] ?? null;
}

export async function discoverCommand(
  name: string,
  timeoutMs?: number,
): Promise<{ path: string | null; error?: string }> {
  const timeout = clampTimeout(timeoutMs);
  const isWindows = os.platform() === "win32";

  try {
    if (isWindows) {
      const result = await execWithTimeout("cmd", ["/c", "where", name], timeout);
      if (result.exitCode === 0 && result.stdout.trim()) {
        const paths = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        return { path: preferWindowsExecutable(paths) };
      }
      return { path: null };
    }
    const result = await execWithTimeout("sh", ["-c", `command -v "${name}"`], timeout);
    if (result.exitCode === 0 && result.stdout.trim()) {
      return { path: result.stdout.trim() };
    }
    return { path: null };
  } catch (err) {
    const error = err as Error;
    return { path: null, error: error.message };
  }
}

export async function runVersionCommand(
  command: string,
  versionArgs: string[],
  timeoutMs?: number,
): Promise<ProbeExecResult> {
  const timeout = clampTimeout(timeoutMs);
  return execWithTimeout(command, versionArgs, timeout);
}

export async function executeProbe(
  id: string,
  category: CapabilityProbeCategory,
  name: string,
  candidates: string[],
  versionArgs: string[],
  evidenceDate: string,
  timeoutMs?: number,
): Promise<CapabilityProbe> {
  const capturedAt = Date.now();
  const evidenceRef = `probes/${evidenceDate}.jsonl`;

  let foundPath: string | null = null;
  let usedCommand: string | null = null;

  for (const candidate of candidates) {
    const discovery = await discoverCommand(candidate, timeoutMs);
    if (discovery.path) {
      foundPath = discovery.path;
      usedCommand = candidate;
      break;
    }
  }

  if (!foundPath) {
    return {
      id,
      category,
      name,
      status: "unavailable",
      confidence: 0.9,
      capturedAt,
      evidenceRef,
    };
  }

  const versionResult = await runVersionCommand(
    foundPath,
    versionArgs,
    timeoutMs,
  );
  const status = statusFromVersionResult(versionResult);

  const version = versionResult.exitCode === 0
    ? extractVersion(versionResult.stdout, versionResult.stderr)
    : undefined;

  return {
    id,
    category,
    name,
    status: status.status,
    command: usedCommand ?? candidates[0],
    path: foundPath,
    version,
    exitCode: versionResult.exitCode ?? undefined,
    stdoutPreview: versionResult.stdout || undefined,
    stderrPreview: versionResult.stderr || undefined,
    confidence: status.confidence,
    capturedAt,
    evidenceRef,
  };
}

export function collectOSInfo() {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    pathSeparator: os.platform() === "win32" ? ";" : ":",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale,
  };
}

export async function collectShellInfo(): Promise<{
  defaultShell: string;
  availableShells: string[];
  powershellVersion?: string;
}> {
  const isWindows = os.platform() === "win32";
  const defaultShell = process.env.SHELL ?? process.env.ComSpec ?? (isWindows ? "cmd" : "/bin/sh");

  const shellCandidates = isWindows
    ? ["powershell", "pwsh", "cmd"]
    : ["bash", "zsh", "fish", "sh"];

  const availableShells: string[] = [];
  let powershellVersion: string | undefined;

  for (const shell of shellCandidates) {
    const discovery = await discoverCommand(shell);
    if (discovery.path) {
      availableShells.push(shell);
    }
  }

  if (isWindows) {
    const pwshDiscovery = await discoverCommand("pwsh");
    const psDiscovery = await discoverCommand("powershell");
    const psCmd = pwshDiscovery.path ?? psDiscovery.path;

    if (psCmd) {
      const versionResult = await runVersionCommand(psCmd, ["-Command", "$PSVersionTable.PSVersion.ToString()"]);
      if (versionResult.exitCode === 0 && versionResult.stdout.trim()) {
        powershellVersion = versionResult.stdout.trim();
      }
    }
  }

  return { defaultShell, availableShells, powershellVersion };
}

export function sanitizeProxyEnv(): Record<string, string> {
  const proxyVars = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  const result: Record<string, string> = {};

  for (const key of proxyVars) {
    const value = process.env[key];
    if (value) {
      const sanitized = value.replace(/:([^:@]+)@/, ":****@");
      result[key] = sanitized;
    }
  }

  return result;
}
