import { FileSystemMemoryCandidateStore } from "../memory";
import type { MemoryAtomScopeType, MemoryAtomType, MemoryEvidenceRef } from "../memory";
import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";

const MEMORY_TYPES: MemoryAtomType[] = [
  "user_preference",
  "project_fact",
  "decision",
  "constraint",
  "routine",
  "procedural",
  "relationship",
];

const SCOPE_TYPES: MemoryAtomScopeType[] = [
  "global",
  "user",
  "project",
  "task",
  "agent",
];

function normalizeMemoryType(value: unknown): MemoryAtomType | undefined {
  return typeof value === "string" && MEMORY_TYPES.includes(value as MemoryAtomType)
    ? value as MemoryAtomType
    : undefined;
}

function normalizeScopeType(value: unknown): MemoryAtomScopeType | undefined {
  return typeof value === "string" && SCOPE_TYPES.includes(value as MemoryAtomScopeType)
    ? value as MemoryAtomScopeType
    : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

async function createMemoryCandidate(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const ctx = context.getCurrentContext?.();
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content) return JSON.stringify({ success: false, message: "content is required" });

  const store = new FileSystemMemoryCandidateStore(context.dataDir);
  store.init();

  const pointer = context.taskStore
    ? await context.taskStore.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId)
    : null;
  const task = pointer && context.taskStore
    ? await context.taskStore.getTask(pointer.taskId)
    : null;

  const evidenceRefs: MemoryEvidenceRef[] = [];
  if (task) evidenceRefs.push({ kind: "task", id: task.id });

  const candidate = await store.create({
    source: "explicit_user_request",
    status: "pending",
    content,
    proposedType: normalizeMemoryType(args.type),
    scopeType: normalizeScopeType(args.scopeType) ?? (task ? "project" : "user"),
    scope: {
      userId: ctx.userId,
      channel: ctx.channel,
      conversationId: ctx.conversationId,
      taskId: task?.id,
      projectRoot: context.projectRoot,
    },
    subject: typeof args.subject === "string" ? args.subject.trim() : undefined,
    reason: typeof args.reason === "string" ? args.reason.trim() : undefined,
    confidence: clampNumber(args.confidence, 0.95, 0, 1),
    salience: clampNumber(args.salience, 0.8, 0, 1),
    requiresConsolidation: true,
    evidenceRefs,
    tags: Array.isArray(args.tags)
      ? args.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : undefined,
  });

  return JSON.stringify({
    success: true,
    candidateId: candidate.id,
    status: candidate.status,
    message: "已记录为 memory candidate，后续 memory sleep 会决定是否沉淀为长期记忆。",
  });
}

export function createMemoryTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "create_memory_candidate",
      description: [
        "创建长期记忆候选。当用户明确表达长期偏好、项目约定、以后默认做法、以后不要做的约束、稳定事实或重要决策时调用。",
        "不要为一次性临时任务、普通问答、闲聊或未经确认的敏感信息调用。",
        "该工具只创建候选，不会直接写入长期记忆；候选将在 memory sleep 中整理。",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "要记录为候选记忆的完整内容，使用明确、可长期复用的表述" },
          type: {
            type: "string",
            enum: MEMORY_TYPES,
            description: "候选记忆类型，可不填",
          },
          scopeType: {
            type: "string",
            enum: SCOPE_TYPES,
            description: "作用域；项目约定优先使用 project，用户偏好优先使用 user",
          },
          subject: { type: "string", description: "候选记忆主题，如 Augustus development workflow" },
          reason: { type: "string", description: "为什么这条信息值得长期保留" },
          confidence: { type: "number", description: "置信度，0-1" },
          salience: { type: "number", description: "重要度，0-1" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "检索标签",
          },
        },
        required: ["content"],
      },
      risk: "write",
      scopes: ["memory"],
      handler: async (_name, args) => createMemoryCandidate(context, args),
    },
  ];
}
