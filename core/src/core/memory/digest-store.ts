import * as fs from "node:fs";
import * as path from "node:path";
import type { DailyDigest } from "./types";

export class FileSystemMemoryDigestStore {
  private baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "memory", "digests");
  }

  init(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async save(digest: DailyDigest): Promise<void> {
    await fs.promises.writeFile(this.digestPath(digest.dateKey), JSON.stringify(digest, null, 2), "utf-8");
  }

  async load(dateKey: string): Promise<DailyDigest | null> {
    const filePath = this.digestPath(dateKey);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as DailyDigest;
    } catch {
      return null;
    }
  }

  async listRecent(limit = 3): Promise<DailyDigest[]> {
    if (!fs.existsSync(this.baseDir)) return [];

    const files = await fs.promises.readdir(this.baseDir);
    const dateKeys = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort()
      .reverse()
      .slice(0, limit);

    const digests: DailyDigest[] = [];
    for (const dateKey of dateKeys) {
      const digest = await this.load(dateKey);
      if (digest) digests.push(digest);
    }
    return digests;
  }

  private digestPath(dateKey: string): string {
    return path.join(this.baseDir, `${dateKey}.json`);
  }
}
