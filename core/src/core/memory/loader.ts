import type { FileSystemMemoryDigestStore } from "./digest-store";
import type { FileSystemMemoryAtomStore } from "./atom-store";
import type { MemoryAtom, MemoryScope } from "./types";

export class MemoryLoader {
  constructor(
    private digestStore: FileSystemMemoryDigestStore,
    private atomStore?: FileSystemMemoryAtomStore,
  ) {}

  async buildPromptContext(options?: {
    maxDigests?: number;
    maxAtoms?: number;
    maxChars?: number;
    scope?: MemoryScope;
  }): Promise<string> {
    const maxDigests = options?.maxDigests ?? readIntEnv("AUGUSTUS_MEMORY_MAX_DIGESTS", 3, 0, 10);
    const maxAtoms = options?.maxAtoms ?? readIntEnv("AUGUSTUS_MEMORY_MAX_ATOMS", 12, 0, 50);
    const maxChars = options?.maxChars ?? readIntEnv("AUGUSTUS_MEMORY_PROMPT_CHARS", 4000, 500, 12000);
    const digests = await this.digestStore.listRecent(maxDigests);
    const atoms = this.atomStore
      ? this.selectScopedAtoms(
        await this.atomStore.list({ status: "active", isActivated: true, limit: maxAtoms * 3 }),
        options?.scope,
        maxAtoms,
      )
      : [];

    if (digests.length === 0 && atoms.length === 0) return "";

    const lines: string[] = [
      "## 长期记忆",
      "以下内容来自 Augustus 的 memory 系统，是辅助上下文；涉及当前事实时仍需核对。",
    ];

    if (atoms.length > 0) {
      lines.push("");
      lines.push("### 稳定记忆");
      for (const atom of atoms) {
        lines.push(`- [${atom.type}/${atom.scopeType}] ${atom.statement}`);
      }
    }

    if (digests.length > 0) {
      lines.push("");
      lines.push("### 近期 sleep digest");
      for (const digest of digests) {
        lines.push("");
        lines.push(`#### ${digest.dateKey}`);
        lines.push(`- 摘要: ${digest.summary}`);
        if (digest.taskIds.length > 0) {
          lines.push(`- 相关任务: ${digest.taskIds.map((id) => id.slice(-4)).join(", ")}`);
        }
        for (const highlight of digest.highlights.slice(0, 8)) {
          lines.push(`- ${highlight}`);
        }
      }
    }

    const context = lines.join("\n");
    if (this.atomStore && atoms.length > 0) {
      await this.atomStore.touchActivated(atoms.map((atom) => atom.id));
    }
    return context.length > maxChars ? `${context.slice(0, maxChars)}\n...（记忆摘要已截断）` : context;
  }

  private selectScopedAtoms(atoms: MemoryAtom[], scope: MemoryScope | undefined, limit: number): MemoryAtom[] {
    if (!scope) return atoms.slice(0, limit);
    return atoms.filter((atom) => scopeMatches(atom.scope, scope)).slice(0, limit);
  }
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function scopeMatches(atomScope: MemoryScope, currentScope: MemoryScope): boolean {
  if (atomScope.userId && atomScope.userId !== currentScope.userId) return false;
  if (atomScope.projectRoot && atomScope.projectRoot !== currentScope.projectRoot) return false;
  if (atomScope.taskId && atomScope.taskId !== currentScope.taskId) return false;
  if (atomScope.agentType && atomScope.agentType !== currentScope.agentType) return false;
  return true;
}
