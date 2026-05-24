import * as fs from "node:fs";
import * as path from "node:path";
import { formatDateKey } from "../../utils/time-zone";
import type { MemoryRawEvent, MemoryStoreFilter } from "./types";

export class FileSystemMemoryEventStore {
  private baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "memory");
  }

  init(): void {
    for (const dir of [
      this.rawEventsDir(),
      path.join(this.baseDir, "episodes"),
      path.join(this.baseDir, "atoms"),
      path.join(this.baseDir, "digests"),
      path.join(this.baseDir, "candidates"),
      path.join(this.baseDir, "indexes"),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async append(event: Omit<MemoryRawEvent, "id" | "dateKey"> & { id?: string; dateKey?: string }): Promise<MemoryRawEvent> {
    const saved: MemoryRawEvent = {
      ...event,
      id: event.id ?? this.generateEventId(),
      dateKey: event.dateKey ?? formatDateKey(new Date(event.timestamp)),
    };

    const events = await this.readDay(saved.dateKey);
    events.push(saved);
    await this.writeDay(saved.dateKey, events);
    return saved;
  }

  async list(filter: MemoryStoreFilter = {}): Promise<MemoryRawEvent[]> {
    const dateKeys = filter.dateKey ? [filter.dateKey] : await this.listDateKeys();
    const events: MemoryRawEvent[] = [];

    for (const dateKey of dateKeys) {
      events.push(...await this.readDay(dateKey));
    }

    return events
      .filter((event) => filter.startAt === undefined || event.timestamp >= filter.startAt)
      .filter((event) => filter.endAt === undefined || event.timestamp <= filter.endAt)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private rawEventsDir(): string {
    return path.join(this.baseDir, "raw-events");
  }

  private dayPath(dateKey: string): string {
    return path.join(this.rawEventsDir(), `${dateKey}.json`);
  }

  private async listDateKeys(): Promise<string[]> {
    if (!fs.existsSync(this.rawEventsDir())) return [];
    const files = await fs.promises.readdir(this.rawEventsDir());
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
  }

  private async readDay(dateKey: string): Promise<MemoryRawEvent[]> {
    const filePath = this.dayPath(dateKey);
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryRawEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeDay(dateKey: string, events: MemoryRawEvent[]): Promise<void> {
    await fs.promises.writeFile(this.dayPath(dateKey), JSON.stringify(events, null, 2), "utf-8");
  }

  private generateEventId(): string {
    const rand = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `mem_evt_${Date.now()}_${rand}`;
  }
}
