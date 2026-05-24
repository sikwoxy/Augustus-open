import type { ToolHandler } from "../loop/types";

export type ToolRisk =
  | "read"
  | "write"
  | "execute"
  | "network"
  | "external_send"
  | "destructive";

export type ToolScope =
  | "project"
  | "artifact"
  | "memory"
  | "task"
  | "agent"
  | "experience"
  | "shell"
  | "git"
  | "web"
  | "browser";

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
  risk?: ToolRisk;
  scopes?: ToolScope[];
  timeoutMs?: number;
  outputLimitBytes?: number;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  resolve(allowedTools?: string[]): RegisteredTool[] {
    if (!allowedTools) return this.list();
    const allowed = new Set(allowedTools);
    return this.list().filter((tool) => allowed.has(tool.name));
  }
}
