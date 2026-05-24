// ═══════════════════════════════════════════════
// Debug 日志记录器
//
// 当 AUGUSTUS_DEBUG_MODE=true 时启用，
// 每次启动在 temp/feishu-debug/ 下创建时间目录，
// 本轮对话记录均写入该子目录，方便区分不同测试会话。
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage } from "../core/task/types";
import { serializeError, type SerializedError } from "./diagnostics";

const DEBUG_ENV_VAR = "AUGUSTUS_DEBUG_MODE";
const DEBUG_BASE_DIR = path.resolve(process.cwd(), "temp", "feishu-debug");

let enabled = false;
let initialized = false;
/** 本次启动的会话目录（如 2026-05-01T15-30-00），首次写入时创建 */
let sessionDir: string | null = null;

interface DebugRecord {
  timestamp: string;
  incoming: {
    channel: string;
    userId: string;
    conversationId: string;
    text: string;
    agentHint?: string;
    rawTimestamp: number;
  };
  result: {
    taskId?: string;
    taskStatus: string;
    replyText: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
    diagnostics?: unknown;
  };
  error?: SerializedError;
  meta: {
    nodeVersion: string;
    pid: number;
    startTime: string;
  };
}

function isEnabled(): boolean {
  if (!initialized) {
    const val = process.env[DEBUG_ENV_VAR];
    enabled = val === "true" || val === "1";
    initialized = true;

    if (enabled) {
      const ts = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
      sessionDir = path.join(DEBUG_BASE_DIR, ts);
      fs.mkdirSync(sessionDir, { recursive: true });
      console.log(
        `[${new Date().toISOString()}] DEBUG 模式已启用，本次会话目录: ${sessionDir}/`,
      );
    }
  }
  return enabled;
}

export function writeDebugRecord(
  incoming: IncomingMessage,
  result: {
    taskId?: string;
    taskStatus: string;
    replyText: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    latencyMs: number;
    diagnostics?: unknown;
  },
  error?: unknown,
): void {
  if (!isEnabled()) return;

  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-");
  const safeId = incoming.conversationId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const filename = `${ts.slice(11)}_${safeId}.json`;
  const filePath = path.join(sessionDir!, filename);

  const record: DebugRecord = {
    timestamp: now.toISOString(),
    incoming: {
      channel: incoming.channel,
      userId: incoming.userId,
      conversationId: incoming.conversationId,
      text: incoming.text,
      agentHint: incoming.agentHint,
      rawTimestamp: incoming.timestamp,
    },
    result: {
      taskId: result.taskId,
      taskStatus: result.taskStatus,
      replyText: result.replyText,
      usage: result.usage,
      latencyMs: result.latencyMs,
      diagnostics: result.diagnostics,
    },
    meta: {
      nodeVersion: process.version,
      pid: process.pid,
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
  };

  if (error) {
    record.error = serializeError(error);
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] DEBUG 写入失败 | ${filePath} | ${String(err)}`,
    );
  }
}

export function writeDebugArtifact(kind: string, id: string, payload: unknown): void {
  if (!isEnabled()) return;

  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-");
  const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "artifact";
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unknown";
  const filePath = path.join(sessionDir!, `${ts.slice(11)}_${safeKind}_${safeId}.json`);

  const record = {
    timestamp: now.toISOString(),
    kind,
    payload,
    meta: {
      nodeVersion: process.version,
      pid: process.pid,
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] DEBUG 鍐欏叆澶辫触 | ${filePath} | ${String(err)}`,
    );
  }
}

export function isDebugEnabled(): boolean {
  return isEnabled();
}
