import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryCandidate, MemoryCandidateFilter } from "./types";

export class FileSystemMemoryCandidateStore {
  private baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "memory", "candidates");
  }

  init(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async save(candidate: MemoryCandidate): Promise<MemoryCandidate> {
    const candidates = await this.readAll();
    const index = candidates.findIndex((item) => item.id === candidate.id);
    const saved: MemoryCandidate = { ...candidate, updatedAt: Date.now() };

    if (index >= 0) {
      candidates[index] = saved;
    } else {
      candidates.push(saved);
    }

    await this.writeAll(candidates);
    return saved;
  }

  async create(candidate: Omit<MemoryCandidate, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<MemoryCandidate> {
    const now = Date.now();
    const saved: MemoryCandidate = {
      ...candidate,
      id: candidate.id ?? this.generateCandidateId(),
      createdAt: now,
      updatedAt: now,
    };

    const candidates = await this.readAll();
    candidates.push(saved);
    await this.writeAll(candidates);
    return saved;
  }

  async get(id: string): Promise<MemoryCandidate | null> {
    const candidates = await this.readAll();
    return candidates.find((candidate) => candidate.id === id) ?? null;
  }

  async list(filter: MemoryCandidateFilter = {}): Promise<MemoryCandidate[]> {
    const candidates = await this.readAll();
    const filtered = candidates
      .filter((candidate) => !filter.status || candidate.status === filter.status)
      .filter((candidate) => !filter.source || candidate.source === filter.source)
      .sort((a, b) => {
        if (b.salience !== a.salience) return b.salience - a.salience;
        return b.updatedAt - a.updatedAt;
      });

    return filtered.slice(0, filter.limit ?? filtered.length);
  }

  async updateStatus(id: string, status: MemoryCandidate["status"], options?: { atomId?: string }): Promise<MemoryCandidate | null> {
    const candidate = await this.get(id);
    if (!candidate) return null;

    return this.save({
      ...candidate,
      status,
      atomId: options?.atomId ?? candidate.atomId,
      reviewedAt: Date.now(),
    });
  }

  private candidatesPath(): string {
    return path.join(this.baseDir, "candidates.json");
  }

  private async readAll(): Promise<MemoryCandidate[]> {
    const filePath = this.candidatesPath();
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryCandidate[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeAll(candidates: MemoryCandidate[]): Promise<void> {
    await fs.promises.writeFile(this.candidatesPath(), JSON.stringify(candidates, null, 2), "utf-8");
  }

  private generateCandidateId(): string {
    const rand = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `mem_cand_${Date.now()}_${rand}`;
  }
}
