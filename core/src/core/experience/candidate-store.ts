import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExperienceApprovalStatus,
  ExperienceCandidate,
  ExperienceCandidateFilter,
} from "./types";

const STATUS_DIRS: ExperienceApprovalStatus[] = [
  "candidate",
  "approved",
  "rejected",
  "superseded",
];

export class FileSystemExperienceCandidateStore {
  private readonly baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.resolve(dataDir, "experience");
  }

  init(): void {
    for (const status of STATUS_DIRS) {
      fs.mkdirSync(this.statusDir(status), { recursive: true });
    }
  }

  async create(
    candidate: Omit<ExperienceCandidate, "id" | "createdAt" | "updatedAt" | "approvalStatus"> & {
      id?: string;
      approvalStatus?: ExperienceApprovalStatus;
    },
  ): Promise<ExperienceCandidate> {
    const now = Date.now();
    const saved: ExperienceCandidate = {
      ...candidate,
      id: candidate.id ?? this.generateCandidateId(),
      approvalStatus: candidate.approvalStatus ?? "candidate",
      createdAt: now,
      updatedAt: now,
    };
    await this.save(saved);
    return saved;
  }

  async save(candidate: ExperienceCandidate): Promise<ExperienceCandidate> {
    this.init();
    const saved: ExperienceCandidate = {
      ...candidate,
      updatedAt: Date.now(),
    };

    await this.removeFromOtherStatusDirs(saved.id, saved.approvalStatus);
    await fs.promises.writeFile(
      this.candidatePath(saved.approvalStatus, saved.id),
      JSON.stringify(saved, null, 2),
      "utf-8",
    );
    return saved;
  }

  async get(id: string): Promise<ExperienceCandidate | null> {
    if (!isSafeId(id)) return null;

    for (const status of STATUS_DIRS) {
      const candidate = await this.readCandidate(this.candidatePath(status, id));
      if (candidate) return candidate;
    }
    return null;
  }

  async list(filter: ExperienceCandidateFilter = {}): Promise<ExperienceCandidate[]> {
    this.init();
    const statuses = filter.approvalStatus ? [filter.approvalStatus] : STATUS_DIRS;
    const candidates: ExperienceCandidate[] = [];

    for (const status of statuses) {
      const dir = this.statusDir(status);
      const entries = await fs.promises.readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const candidate = await this.readCandidate(path.join(dir, entry));
        if (candidate) candidates.push(candidate);
      }
    }

    const filtered = candidates
      .filter((candidate) => !filter.kind || candidate.kind === filter.kind)
      .filter((candidate) => !filter.toolName || candidate.scope.toolName === filter.toolName)
      .filter((candidate) => !filter.projectRoot || candidate.scope.projectRoot === filter.projectRoot)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return filtered.slice(0, filter.limit ?? filtered.length);
  }

  async updateStatus(
    id: string,
    approvalStatus: ExperienceApprovalStatus,
    options: { reviewNote?: string; supersededBy?: string } = {},
  ): Promise<ExperienceCandidate | null> {
    const candidate = await this.get(id);
    if (!candidate) return null;

    return this.save({
      ...candidate,
      approvalStatus,
      reviewNote: options.reviewNote ?? candidate.reviewNote,
      supersededBy: options.supersededBy ?? candidate.supersededBy,
      reviewedAt: Date.now(),
    });
  }

  private statusDir(status: ExperienceApprovalStatus): string {
    return path.join(this.baseDir, status);
  }

  private candidatePath(status: ExperienceApprovalStatus, id: string): string {
    return path.join(this.statusDir(status), `${id}.json`);
  }

  private async removeFromOtherStatusDirs(id: string, currentStatus: ExperienceApprovalStatus): Promise<void> {
    for (const status of STATUS_DIRS) {
      if (status === currentStatus) continue;
      await fs.promises.rm(this.candidatePath(status, id), { force: true }).catch(() => {});
    }
  }

  private async readCandidate(filePath: string): Promise<ExperienceCandidate | null> {
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as ExperienceCandidate;
      return isExperienceCandidate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private generateCandidateId(): string {
    const rand = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `exp_cand_${Date.now()}_${rand}`;
  }
}

function isExperienceCandidate(value: unknown): value is ExperienceCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExperienceCandidate>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.claim === "string" &&
    Array.isArray(candidate.evidenceRefs) &&
    (candidate.kind === "tool_behavior" ||
      candidate.kind === "tool_failure_pattern" ||
      candidate.kind === "verification_pattern" ||
      candidate.kind === "workflow_pattern")
  );
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}
