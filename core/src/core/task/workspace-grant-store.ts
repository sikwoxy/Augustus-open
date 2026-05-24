// ═══════════════════════════════════════════════
// WorkspaceGrantStore — task-scoped workspace authorization
//
// A grant is created only after the user confirms the implementation boundary.
// Tools use it to decide where project writes and shell execution are allowed.
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceGrant, WorkspacePermission } from "./types";

export interface WorkspaceGrantStore {
  init(): void;
  getGrant(taskId: string): Promise<WorkspaceGrant | null>;
  saveGrant(grant: WorkspaceGrant): Promise<WorkspaceGrant>;
}

export class FileSystemWorkspaceGrantStore implements WorkspaceGrantStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  init(): void {
    fs.mkdirSync(this.grantsRoot(), { recursive: true });
  }

  private grantsRoot(): string {
    return path.join(this.baseDir, "workspace-grants");
  }

  private grantPath(taskId: string): string {
    return path.join(this.grantsRoot(), `${safePathSegment(taskId)}.json`);
  }

  async getGrant(taskId: string): Promise<WorkspaceGrant | null> {
    const filePath = this.grantPath(taskId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return normalizeGrant(JSON.parse(raw) as Partial<WorkspaceGrant>, taskId);
    } catch {
      return null;
    }
  }

  async saveGrant(grant: WorkspaceGrant): Promise<WorkspaceGrant> {
    const normalized = normalizeGrant(grant, grant.taskId);
    await fs.promises.writeFile(
      this.grantPath(normalized.taskId),
      JSON.stringify(normalized, null, 2),
      "utf-8",
    );
    return normalized;
  }
}

function normalizeGrant(input: Partial<WorkspaceGrant>, taskId: string): WorkspaceGrant {
  return {
    taskId,
    root: path.resolve(String(input.root ?? ".")),
    permissions: normalizePermissions(input.permissions),
    destructive: false,
    approvedAt: typeof input.approvedAt === "number" ? input.approvedAt : Date.now(),
    approvedBy: typeof input.approvedBy === "string" && input.approvedBy ? input.approvedBy : "unknown",
    note: typeof input.note === "string" ? input.note : undefined,
  };
}

function normalizePermissions(input: unknown): WorkspacePermission[] {
  const allowed = new Set<WorkspacePermission>(["read", "write", "execute", "network"]);
  const values = Array.isArray(input) ? input : [];
  const normalized = values.filter((value): value is WorkspacePermission => allowed.has(value));
  return Array.from(new Set(normalized));
}

function safePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_");
}
