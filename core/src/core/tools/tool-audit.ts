import * as fs from "node:fs";
import * as path from "node:path";
import { serializeError, type SerializedError } from "../../utils/diagnostics";
import type { ToolHandler } from "../loop/types";
import type { RegisteredTool, ToolRisk, ToolScope } from "./registry";
import type { ArtifactRef } from "./tool-result";

export interface ToolAuditRecord {
  id: string;
  timestamp: number;
  traceId?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  agentType?: string;
  toolName: string;
  risk: ToolRisk;
  scopes: ToolScope[];
  argsPreview: string;
  resultPreview: string;
  success: boolean;
  error?: SerializedError;
  artifacts?: ArtifactRef[];
  latencyMs: number;
}

export interface ToolAuditContext {
  traceId?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  agentType?: string;
}

export class FileSystemToolAuditStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, "tool-runs");
  }

  init(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async append(record: ToolAuditRecord): Promise<void> {
    this.init();
    const dateKey = new Date(record.timestamp).toISOString().slice(0, 10);
    const filePath = path.join(this.dir, `${dateKey}.jsonl`);
    await fs.promises.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
  }

  async get(id: string): Promise<ToolAuditRecord | null> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;

    this.init();
    const files = (await fs.promises.readdir(this.dir).catch(() => []))
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .reverse();

    for (const file of files) {
      const filePath = path.join(this.dir, file);
      const raw = await fs.promises.readFile(filePath, "utf-8").catch(() => "");
      if (!raw) continue;

      const lines = raw.split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        const record = parseAuditRecord(line);
        if (record?.id === id) return record;
      }
    }
    return null;
  }

  async list(options: { dateKey?: string; limit?: number; toolName?: string } = {}): Promise<ToolAuditRecord[]> {
    this.init();
    const files = options.dateKey
      ? [`${options.dateKey}.jsonl`]
      : (await fs.promises.readdir(this.dir).catch(() => []))
        .filter((name) => name.endsWith(".jsonl"))
        .sort()
        .reverse();

    const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
    const records: ToolAuditRecord[] = [];

    for (const file of files) {
      const filePath = path.join(this.dir, file);
      const raw = await fs.promises.readFile(filePath, "utf-8").catch(() => "");
      if (!raw) continue;

      const parsed = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => parseAuditRecord(line))
        .filter((record): record is ToolAuditRecord => Boolean(record))
        .filter((record) => !options.toolName || record.toolName === options.toolName)
        .sort((a, b) => b.timestamp - a.timestamp);

      for (const record of parsed) {
        records.push(record);
        if (records.length >= limit) return records;
      }
    }

    return records;
  }
}

export function withToolAudit(
  tool: RegisteredTool,
  store: FileSystemToolAuditStore,
  contextProvider?: () => ToolAuditContext | undefined,
): RegisteredTool {
  const handler: ToolHandler = async (name, args) => {
    const startedAt = Date.now();
    let result = "";
    let thrown: unknown;

    try {
      result = await tool.handler(name, args);
      return result;
    } catch (err) {
      thrown = err;
      result = JSON.stringify({ success: false, error: serializeError(err) });
      throw err;
    } finally {
      const latencyMs = Date.now() - startedAt;
      const context = contextProvider?.();
      const parsed = parseResult(result);
      const record: ToolAuditRecord = {
        id: `tool_${startedAt}_${Math.random().toString(36).slice(2, 10)}`,
        timestamp: startedAt,
        traceId: context?.traceId,
        sessionId: context?.sessionId,
        taskId: context?.taskId,
        runId: context?.runId,
        agentType: context?.agentType,
        toolName: tool.name,
        risk: tool.risk ?? "read",
        scopes: tool.scopes ?? [],
        argsPreview: redactAndTrim(args, 1200),
        resultPreview: redactAndTrim(result, 2000),
        success: thrown ? false : parsed.success,
        error: thrown ? serializeError(thrown) : parsed.error,
        artifacts: parsed.artifacts,
        latencyMs,
      };
      await store.append(record).catch(() => {});
    }
  };

  return { ...tool, handler };
}

function parseResult(result: string): {
  success: boolean;
  error?: SerializedError;
  artifacts?: ArtifactRef[];
} {
  try {
    const value = JSON.parse(result) as Record<string, unknown>;
    const success = value.success === false || value.error === true ? false : true;
    const error = isSerializedError(value.error) ? value.error : undefined;
    const artifacts = Array.isArray(value.artifacts) ? value.artifacts as ArtifactRef[] : undefined;
    return { success, error, artifacts };
  } catch {
    return { success: true };
  }
}

function isSerializedError(value: unknown): value is SerializedError {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { message?: unknown }).message === "string",
  );
}

function redactAndTrim(value: unknown, maxChars: number): string {
  const json = typeof value === "string" ? value : safeStringify(value);
  const redacted = json
    .replace(/(api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "$1:<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}...` : redacted;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseAuditRecord(line: string): ToolAuditRecord | null {
  try {
    const parsed = JSON.parse(line) as ToolAuditRecord;
    return parsed && typeof parsed.id === "string" && typeof parsed.toolName === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
