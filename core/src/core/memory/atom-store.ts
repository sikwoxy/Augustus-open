import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryAtom, MemoryAtomFilter } from "./types";

export class FileSystemMemoryAtomStore {
  private baseDir: string;

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, "memory", "atoms");
  }

  init(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async save(atom: MemoryAtom): Promise<MemoryAtom> {
    const atoms = await this.readAll();
    const index = atoms.findIndex((item) => item.id === atom.id);
    const saved = { ...atom, isActivated: atom.isActivated ?? true, updatedAt: Date.now() };

    if (index >= 0) {
      atoms[index] = saved;
    } else {
      atoms.push(saved);
    }

    await this.writeAll(atoms);
    return saved;
  }

  async create(atom: Omit<MemoryAtom, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<MemoryAtom> {
    const now = Date.now();
    const saved: MemoryAtom = {
      ...atom,
      id: atom.id ?? this.generateAtomId(),
      isActivated: atom.isActivated ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const atoms = await this.readAll();
    atoms.push(saved);
    await this.writeAll(atoms);
    return saved;
  }

  async upsertByKey(atom: Omit<MemoryAtom, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<MemoryAtom> {
    const atoms = await this.readAll();
    const now = Date.now();
    const existingIndex = atom.key
      ? atoms.findIndex((item) => item.key === atom.key)
      : -1;

    if (existingIndex >= 0) {
      const existing = atoms[existingIndex];
      const saved: MemoryAtom = {
        ...existing,
        ...atom,
        id: existing.id,
        isActivated: atom.isActivated ?? existing.isActivated ?? true,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      atoms[existingIndex] = saved;
      await this.writeAll(atoms);
      return saved;
    }

    const saved: MemoryAtom = {
      ...atom,
      id: atom.id ?? this.generateAtomId(),
      isActivated: atom.isActivated ?? true,
      createdAt: now,
      updatedAt: now,
    };
    atoms.push(saved);
    await this.writeAll(atoms);
    return saved;
  }

  async get(id: string): Promise<MemoryAtom | null> {
    const atoms = await this.readAll();
    return atoms.find((atom) => atom.id === id) ?? null;
  }

  async list(filter: MemoryAtomFilter = {}): Promise<MemoryAtom[]> {
    const atoms = await this.readAll();
    const filtered = atoms
      .filter((atom) => !filter.key || atom.key === filter.key)
      .filter((atom) => !filter.status || atom.status === filter.status)
      .filter((atom) => !filter.type || atom.type === filter.type)
      .filter((atom) => !filter.scopeType || atom.scopeType === filter.scopeType)
      .filter((atom) => filter.isActivated === undefined || (atom.isActivated ?? true) === filter.isActivated)
      .sort((a, b) => {
        if (b.salience !== a.salience) return b.salience - a.salience;
        return b.updatedAt - a.updatedAt;
      });

    return filtered.slice(0, filter.limit ?? filtered.length);
  }

  async search(query: string, options?: { limit?: number; includeInactive?: boolean }): Promise<MemoryAtom[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    if (terms.length === 0) return [];

    const atoms = await this.readAll();
    const scored = atoms
      .filter((atom) => options?.includeInactive || atom.status === "active")
      .map((atom) => {
        const haystack = [
          atom.type,
          atom.scopeType,
          atom.subject,
          atom.statement,
          ...(atom.tags ?? []),
        ].join(" ").toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { atom, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.atom.salience !== a.atom.salience) return b.atom.salience - a.atom.salience;
        return b.atom.updatedAt - a.atom.updatedAt;
      });

    return scored.slice(0, options?.limit ?? 20).map((item) => item.atom);
  }

  async markSuperseded(id: string, supersededBy?: string): Promise<MemoryAtom | null> {
    const atom = await this.get(id);
    if (!atom) return null;

    return this.save({
      ...atom,
      status: "superseded",
      isActivated: false,
      deactivatedAt: Date.now(),
      deactivationReason: supersededBy
        ? `superseded by ${supersededBy}`
        : "superseded by newer memory",
      supersededBy: supersededBy ?? atom.supersededBy,
    });
  }

  async setActivated(id: string, isActivated: boolean, reason?: string): Promise<MemoryAtom | null> {
    const atom = await this.get(id);
    if (!atom) return null;

    const now = Date.now();
    return this.save({
      ...atom,
      isActivated,
      activatedAt: isActivated ? atom.activatedAt ?? now : atom.activatedAt,
      lastActivatedAt: isActivated ? now : atom.lastActivatedAt,
      deactivatedAt: isActivated ? atom.deactivatedAt : now,
      activationReason: isActivated ? reason ?? atom.activationReason : atom.activationReason,
      deactivationReason: isActivated ? atom.deactivationReason : reason ?? atom.deactivationReason,
    });
  }

  async touchActivated(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const atoms = await this.readAll();
    const now = Date.now();
    let changed = false;

    for (const atom of atoms) {
      if (!idSet.has(atom.id)) continue;
      atom.lastAccessedAt = now;
      atom.lastActivatedAt = now;
      changed = true;
    }

    if (changed) {
      await this.writeAll(atoms);
    }
  }

  private atomsPath(): string {
    return path.join(this.baseDir, "atoms.json");
  }

  private async readAll(): Promise<MemoryAtom[]> {
    const filePath = this.atomsPath();
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryAtom[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeAll(atoms: MemoryAtom[]): Promise<void> {
    await fs.promises.writeFile(this.atomsPath(), JSON.stringify(atoms, null, 2), "utf-8");
  }

  private generateAtomId(): string {
    const rand = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `mem_atom_${Date.now()}_${rand}`;
  }
}
