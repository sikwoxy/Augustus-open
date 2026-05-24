import type { FileSystemMemoryAtomStore } from "./atom-store";
import type { MemoryAtom } from "./types";

type SeedAtom = Omit<MemoryAtom, "id" | "createdAt" | "updatedAt">;

export async function seedDefaultMemoryAtoms(store: FileSystemMemoryAtomStore): Promise<MemoryAtom[]> {
  const seeds: SeedAtom[] = [
    {
      key: "user_pref:language:zh_cn",
      type: "user_preference",
      scopeType: "global",
      scope: {},
      subject: "用户沟通语言",
      statement: "用户偏好使用中文沟通，回答应直接、工程化、少空话，可适当活跃。",
      confidence: 0.95,
      salience: 0.9,
      status: "active",
      isActivated: true,
      evidenceRefs: [{ kind: "raw_event", id: "manual_seed", note: "根据长期对话方式初始化" }],
      tags: ["language", "communication"],
    },
    {
      key: "user_pref:workflow:plan_then_build",
      type: "user_preference",
      scopeType: "global",
      scope: {},
      subject: "开发协作方式",
      statement: "用户倾向先理清产品设计、架构边界和实施计划，再分阶段落地开发。",
      confidence: 0.9,
      salience: 0.85,
      status: "active",
      isActivated: true,
      evidenceRefs: [{ kind: "raw_event", id: "manual_seed", note: "根据 Augustus 开发过程初始化" }],
      tags: ["workflow", "planning"],
    },
    {
      key: "project_fact:tool_registry",
      type: "project_fact",
      scopeType: "project",
      scope: { projectRoot: process.cwd() },
      subject: "Augustus 工具架构",
      statement: "Augustus 已引入轻量 ToolRegistry，工具定义集中在 src/core/tools 下，并按 AgentProfile.allowedTools 分发。",
      confidence: 0.95,
      salience: 0.9,
      status: "active",
      isActivated: true,
      evidenceRefs: [{ kind: "file", id: "prototype/src/core/tools/register-default-tools.ts" }],
      tags: ["tools", "registry", "architecture"],
    },
    {
      key: "project_fact:memory_mvp",
      type: "project_fact",
      scopeType: "project",
      scope: { projectRoot: process.cwd() },
      subject: "Augustus 记忆系统",
      statement: "Augustus memory MVP 已实现 raw event 记录、手动 memory-sleep 生成 daily digest、wake 时注入最近 digest。",
      confidence: 0.9,
      salience: 0.9,
      status: "active",
      isActivated: true,
      evidenceRefs: [{ kind: "file", id: "prototype/src/core/memory" }],
      tags: ["memory", "digest", "wake"],
    },
    {
      key: "procedural:typescript_check",
      type: "procedural",
      scopeType: "project",
      scope: { projectRoot: process.cwd() },
      subject: "TypeScript 验证",
      statement: "修改 prototype TypeScript 代码后应运行 npx tsc --noEmit 验证类型检查。",
      confidence: 0.95,
      salience: 0.8,
      status: "active",
      isActivated: true,
      evidenceRefs: [{ kind: "raw_event", id: "manual_seed", note: "项目开发约定" }],
      tags: ["typescript", "verification"],
    },
  ];

  const saved: MemoryAtom[] = [];
  for (const seed of seeds) {
    saved.push(await store.upsertByKey(seed));
  }
  return saved;
}
