import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskSession } from "./types";

export const TASK_WORKSPACE_KIND = "task_workspace" as const;

export function safeWorkspaceSegment(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\s]+/g, "_");
  return cleaned || "unknown";
}

export function getTaskWorkspaceRoot(dataDir: string, userId: string, taskId: string): string {
  return path.resolve(
    dataDir,
    "workspaces",
    safeWorkspaceSegment(userId),
    safeWorkspaceSegment(taskId),
  );
}

export async function ensureTaskWorkspace(
  dataDir: string,
  task: TaskSession,
  userId = task.ownerUserId,
): Promise<string> {
  const root = getTaskWorkspaceRoot(dataDir, userId, task.id);
  await fs.promises.mkdir(root, { recursive: true });

  const refs = task.workspaceRefs ?? [];
  if (!refs.some((ref) => path.resolve(ref.root) === root)) {
    task.workspaceRefs = [
      ...refs,
      {
        root,
        label: "default",
        kind: TASK_WORKSPACE_KIND,
        addedAt: Date.now(),
      },
    ];
  }

  return root;
}

export function getDefaultWorkspaceRef(task: TaskSession): string | null {
  const ref =
    task.workspaceRefs?.find((item) => item.kind === TASK_WORKSPACE_KIND) ??
    task.workspaceRefs?.find((item) => item.label === "default");
  return ref ? path.resolve(ref.root) : null;
}
