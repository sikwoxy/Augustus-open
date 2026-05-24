// ═══════════════════════════════════════════════
// 结构化 Logger
//
// JSON 行输出。禁止打印 API key / secret。
// ═══════════════════════════════════════════════

const REDACTED = "***";

const SENSITIVE_KEYS = new Set([
  "apiKey", "api_key", "secret", "password",
  "token", "auth", "credential",
  "LLM_API_KEY", "FEISHU_APP_SECRET", "AUGUSTUS_AUTH_TOKEN",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redact(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): string {
  const { level, message, ...rest } = entry;
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(rest as Record<string, unknown>),
  });
}

export const logger = {
  info(message: string, fields?: Record<string, unknown>) {
    console.log(formatLog({ level: "info", message, ...fields }));
  },
  warn(message: string, fields?: Record<string, unknown>) {
    console.warn(formatLog({ level: "warn", message, ...fields }));
  },
  error(message: string, fields?: Record<string, unknown>) {
    console.error(formatLog({ level: "error", message, ...fields }));
  },
};

export function chatLog(entry: {
  requestId: string;
  channel: string;
  conversationId: string;
  taskId?: string;
  taskStatus: string;
  latencyMs: number;
}) {
  logger.info("chat turn completed", entry);
}
