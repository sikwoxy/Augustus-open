import * as path from "node:path";
import type { ToolRuntimeContext } from "./tool-context";
import type { WorkspaceGrant, WorkspacePermission } from "../task/types";
import { getDefaultWorkspaceRef } from "../task/workspace";

export interface WorkspaceRootOptions {
  allowLocalReadFallback?: boolean;
}

export function normalizeProjectRoot(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.cwd());
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function runtimeMode(context: ToolRuntimeContext): "local-dev" | "production" {
  return context.runtimeMode ?? (process.env.AUGUSTUS_PROFILE === "production" ? "production" : "local-dev");
}

export async function getCurrentWorkspaceGrant(context: ToolRuntimeContext): Promise<WorkspaceGrant | null> {
  const current = context.getCurrentContext?.();
  if (!current || !context.taskStore || !context.workspaceGrantStore) return null;

  const pointer = await context.taskStore.getCurrentPointer(
    current.userId,
    current.channel,
    current.conversationId,
  );
  if (!pointer) return null;
  return context.workspaceGrantStore.getGrant(pointer.taskId);
}

export async function getCurrentTaskWorkspaceRoot(context: ToolRuntimeContext): Promise<string | null> {
  const current = context.getCurrentContext?.();
  if (!current || !context.taskStore) return null;

  const pointer = await context.taskStore.getCurrentPointer(
    current.userId,
    current.channel,
    current.conversationId,
  );
  if (!pointer) return null;

  const task = await context.taskStore.getTask(pointer.taskId);
  return task ? getDefaultWorkspaceRef(task) : null;
}

export async function resolveWorkspaceRootForPermission(
  context: ToolRuntimeContext,
  permission: WorkspacePermission,
  options: WorkspaceRootOptions = {},
): Promise<string> {
  const fallbackRoot = normalizeProjectRoot(context.projectRoot);
  const grant = await getCurrentWorkspaceGrant(context);
  if (grant) {
    if (!grant.permissions.includes(permission)) {
      throw new Error(`WorkspaceGrant does not include ${permission} permission`);
    }
    return normalizeProjectRoot(grant.root);
  }

  const mode = runtimeMode(context);
  if (mode === "production") {
    const taskWorkspaceRoot = await getCurrentTaskWorkspaceRoot(context);
    if (taskWorkspaceRoot) return taskWorkspaceRoot;
    throw new Error("Task workspace is required in production mode");
  }

  if (permission === "read" && options.allowLocalReadFallback !== false) {
    return fallbackRoot;
  }

  throw new Error(`WorkspaceGrant with ${permission} permission is required`);
}
