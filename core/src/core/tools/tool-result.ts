import type { SerializedError } from "../../utils/diagnostics";
import type { ToolRisk, ToolScope } from "./registry";

export interface ArtifactRef {
  id: string;
  type: "file" | "command_output" | "report" | "image" | "dataset" | "url";
  uri: string;
  description?: string;
  sizeBytes?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinitionV1 {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  scopes: ToolScope[];
  timeoutMs?: number;
  outputLimitBytes?: number;
}

export interface ToolResultV1<T = unknown> {
  success: boolean;
  data?: T;
  error?: SerializedError;
  artifacts?: ArtifactRef[];
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  truncated?: boolean;
  latencyMs: number;
  warnings?: string[];
}

export function toolResultString<T>(result: ToolResultV1<T>): string {
  return JSON.stringify(result);
}

