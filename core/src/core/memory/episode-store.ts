import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryEpisode, MemoryStoreFilter } from "./types";

export class FileSystemMemoryEpisodeStore {
  private baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "memory", "episodes");
  }

  init(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async save(episode: MemoryEpisode): Promise<MemoryEpisode> {
    const episodes = await this.readDay(episode.dateKey);
    const index = episodes.findIndex((item) => item.id === episode.id);
    const saved: MemoryEpisode = { ...episode, updatedAt: Date.now() };

    if (index >= 0) {
      episodes[index] = saved;
    } else {
      episodes.push(saved);
    }

    await this.writeDay(episode.dateKey, episodes);
    return saved;
  }

  async upsertByKey(episode: Omit<MemoryEpisode, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<MemoryEpisode> {
    const episodes = await this.readDay(episode.dateKey);
    const now = Date.now();
    const existingIndex = episode.key
      ? episodes.findIndex((item) => item.key === episode.key)
      : -1;

    if (existingIndex >= 0) {
      const existing = episodes[existingIndex];
      const saved: MemoryEpisode = {
        ...existing,
        ...episode,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      episodes[existingIndex] = saved;
      await this.writeDay(episode.dateKey, episodes);
      return saved;
    }

    const saved: MemoryEpisode = {
      ...episode,
      id: episode.id ?? this.generateEpisodeId(),
      createdAt: now,
      updatedAt: now,
    };
    episodes.push(saved);
    await this.writeDay(episode.dateKey, episodes);
    return saved;
  }

  async get(dateKey: string, id: string): Promise<MemoryEpisode | null> {
    const episodes = await this.readDay(dateKey);
    return episodes.find((episode) => episode.id === id) ?? null;
  }

  async list(filter: MemoryStoreFilter = {}): Promise<MemoryEpisode[]> {
    const dateKeys = filter.dateKey ? [filter.dateKey] : await this.listDateKeys();
    const episodes: MemoryEpisode[] = [];

    for (const dateKey of dateKeys) {
      episodes.push(...await this.readDay(dateKey));
    }

    return episodes
      .filter((episode) => filter.startAt === undefined || episode.timeRange.end >= filter.startAt)
      .filter((episode) => filter.endAt === undefined || episode.timeRange.start <= filter.endAt)
      .filter((episode) => !filter.taskId || episode.taskIds.includes(filter.taskId))
      .filter((episode) => !filter.sessionId || episode.scope.sessionId === filter.sessionId)
      .sort((a, b) => a.timeRange.start - b.timeRange.start);
  }

  private dayPath(dateKey: string): string {
    return path.join(this.baseDir, `${dateKey}.json`);
  }

  private async listDateKeys(): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) return [];
    const files = await fs.promises.readdir(this.baseDir);
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
  }

  private async readDay(dateKey: string): Promise<MemoryEpisode[]> {
    const filePath = this.dayPath(dateKey);
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryEpisode[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeDay(dateKey: string, episodes: MemoryEpisode[]): Promise<void> {
    await fs.promises.writeFile(this.dayPath(dateKey), JSON.stringify(episodes, null, 2), "utf-8");
  }

  private generateEpisodeId(): string {
    const rand = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `mem_ep_${Date.now()}_${rand}`;
  }
}
