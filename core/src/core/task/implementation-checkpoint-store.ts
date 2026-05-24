// ═══════════════════════════════════════════════
// ImplementationCheckpointStore — pending implementation boundary checks
// ═══════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ImplementationCheckpoint,
  ImplementationCheckpointRisk,
  ImplementationCheckpointStatus,
} from "./types";

export interface ImplementationCheckpointStore {
  init(): void;
  create(input: Omit<ImplementationCheckpoint, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: ImplementationCheckpointStatus;
  }): Promise<ImplementationCheckpoint>;
  save(checkpoint: ImplementationCheckpoint): Promise<ImplementationCheckpoint>;
  get(taskId: string, checkpointId: string): Promise<ImplementationCheckpoint | null>;
  listByTask(taskId: string): Promise<ImplementationCheckpoint[]>;
  getLatestPending(taskId: string): Promise<ImplementationCheckpoint | null>;
}

export class FileSystemImplementationCheckpointStore implements ImplementationCheckpointStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  init(): void {
    fs.mkdirSync(this.rootDir(), { recursive: true });
  }

  private rootDir(): string {
    return path.join(this.baseDir, "implementation-checkpoints");
  }

  private taskDir(taskId: string): string {
    return path.join(this.rootDir(), safePathSegment(taskId));
  }

  private checkpointPath(taskId: string, checkpointId: string): string {
    return path.join(this.taskDir(taskId), `${safePathSegment(checkpointId)}.json`);
  }

  async create(input: Omit<ImplementationCheckpoint, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: ImplementationCheckpointStatus;
  }): Promise<ImplementationCheckpoint> {
    const now = Date.now();
    const checkpoint = normalizeCheckpoint({
      ...input,
      id: generateCheckpointId(),
      status: input.status ?? "pending",
      createdAt: now,
      updatedAt: now,
    });
    return this.save(checkpoint);
  }

  async save(checkpoint: ImplementationCheckpoint): Promise<ImplementationCheckpoint> {
    const normalized = normalizeCheckpoint({ ...checkpoint, updatedAt: Date.now() });
    fs.mkdirSync(this.taskDir(normalized.taskId), { recursive: true });
    await fs.promises.writeFile(
      this.checkpointPath(normalized.taskId, normalized.id),
      JSON.stringify(normalized, null, 2),
      "utf-8",
    );
    return normalized;
  }

  async get(taskId: string, checkpointId: string): Promise<ImplementationCheckpoint | null> {
    const filePath = this.checkpointPath(taskId, checkpointId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return normalizeCheckpoint(JSON.parse(raw) as ImplementationCheckpoint);
    } catch {
      return null;
    }
  }

  async listByTask(taskId: string): Promise<ImplementationCheckpoint[]> {
    const dir = this.taskDir(taskId);
    if (!fs.existsSync(dir)) return [];
    const files = await fs.promises.readdir(dir);
    const checkpoints: ImplementationCheckpoint[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
        checkpoints.push(normalizeCheckpoint(JSON.parse(raw) as ImplementationCheckpoint));
      } catch {
        // skip damaged file
      }
    }
    return checkpoints.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getLatestPending(taskId: string): Promise<ImplementationCheckpoint | null> {
    const checkpoints = await this.listByTask(taskId);
    return checkpoints.find((checkpoint) => checkpoint.status === "pending") ?? null;
  }
}

function normalizeCheckpoint(input: ImplementationCheckpoint): ImplementationCheckpoint {
  return {
    id: input.id,
    taskId: input.taskId,
    status: normalizeStatus(input.status),
    workspaceRoot: path.resolve(input.workspaceRoot),
    actions: normalizeStringArray(input.actions),
    nonGoals: normalizeStringArray(input.nonGoals),
    acceptanceCriteria: normalizeStringArray(input.acceptanceCriteria),
    willInstallDependencies: Boolean(input.willInstallDependencies),
    willCreateOrUpdateLockfile: Boolean(input.willCreateOrUpdateLockfile),
    risk: normalizeRisk(input.risk),
    question: input.question,
    userResponse: input.userResponse,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : Date.now(),
    confirmedAt: input.confirmedAt,
    confirmedBy: input.confirmedBy,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeStatus(value: unknown): ImplementationCheckpointStatus {
  return value === "confirmed" || value === "cancelled" || value === "pending" ? value : "pending";
}

function normalizeRisk(value: unknown): ImplementationCheckpointRisk {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function generateCheckpointId(): string {
  return `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_");
}
