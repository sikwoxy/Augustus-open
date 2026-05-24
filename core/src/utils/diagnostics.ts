export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerializedError;
  details?: Record<string, unknown>;
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {};
    for (const key of Object.keys(error)) {
      const value = (error as unknown as Record<string, unknown>)[key];
      if (isJsonSafe(value)) details[key] = value;
    }

    const code = (error as unknown as { code?: string | number }).code;
    const cause = (error as unknown as { cause?: unknown }).cause;
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack,
      code,
      cause: cause !== undefined && depth < 4 ? serializeError(cause, depth + 1) : undefined,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    const message =
      typeof value.message === "string"
        ? value.message
        : safeJsonStringify(value) ?? String(error);
    const stack = typeof value.stack === "string" ? value.stack : undefined;
    const code =
      typeof value.code === "string" || typeof value.code === "number"
        ? value.code
        : undefined;
    return {
      name: typeof value.name === "string" ? value.name : "NonErrorObject",
      message,
      stack,
      code,
      details: pickJsonSafeDetails(value),
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}

export function errorMessage(error: unknown): string {
  return serializeError(error).message;
}

export function formatSerializedError(error: SerializedError): string {
  const lines = [`${error.name}: ${error.message}`];
  if (error.code !== undefined) lines.push(`code: ${error.code}`);
  if (error.stack) lines.push(error.stack);
  if (error.cause) {
    lines.push("Caused by:");
    lines.push(indent(formatSerializedError(error.cause), "  "));
  }
  if (error.details && Object.keys(error.details).length > 0) {
    lines.push(`details: ${safeJsonStringify(error.details) ?? "[unserializable]"}`);
  }
  return lines.join("\n");
}

export function formatErrorForLog(error: unknown): string {
  return formatSerializedError(serializeError(error));
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function pickJsonSafeDetails(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "name" || key === "message" || key === "stack" || key === "code") continue;
    if (isJsonSafe(item)) details[key] = item;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (t === "object") {
    try {
      JSON.stringify(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
