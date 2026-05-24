// SessionStore：会话持久化接口 + 文件系统实现
// 每次 turn 后自动保存消息历史，启动时懒加载

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatMessage, ToolCall } from "../../llm/types";
import type { SessionMeta } from "./types";
import type { FileSystemTaskStore } from "../task/store";
import type {
  RuntimeChannel,
  WorkingContextDetail,
  WorkingContextMessage,
  WorkingContextQuery,
  WorkingContextSummary,
} from "../runtime/types";

// ─── 持久化层消息类型 ───

/** 持久化层消息：比 ChatMessage 多一个 taskId 字段，仅在磁盘 JSON 中存在 */
interface PersistedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  /** Anthropic thinking block 签名，回传时必需 */
  thinking_signature?: string;
  /** 所属任务 ID，system 消息 / 无活跃任务时为 null */
  taskId?: string | null;
}

// ─── 接口 ───

export interface SessionStore {
  saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  loadMessages(sessionId: string): Promise<ChatMessage[] | null>;

  /** 保存消息并标记当前活跃任务的 taskId */
  saveMessagesWithTask(
    sessionId: string,
    messages: ChatMessage[],
    currentTaskId: string | null,
    options?: { assignFromIndex?: number },
  ): Promise<void>;

  /** 获取指定任务的全部消息（已剥掉 taskId） */
  getTaskMessages(sessionId: string, taskId: string): Promise<ChatMessage[] | null>;

  listWorkingContextSummaries(
    query?: WorkingContextQuery,
    taskStore?: FileSystemTaskStore,
  ): Promise<WorkingContextSummary[]>;
  getWorkingContextDetail(
    contextId: string,
    taskStore?: FileSystemTaskStore,
  ): Promise<WorkingContextDetail | null>;

  saveMeta(sessionId: string, meta: SessionMeta): Promise<void>;
  loadAllMetas(): Promise<SessionMeta[]>;
  removeSession(sessionId: string): Promise<void>;
}

// ─── 文件系统实现 ───

export class FileSystemSessionStore implements SessionStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.join(baseDir, "sessions");
  }

  init(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/[<>:"/\\|?*]/g, "_");
    return path.join(this.baseDir, `${safe}.json`);
  }

  private indexPath(): string {
    return path.join(this.baseDir, "_index.json");
  }

  // ─── 底层读写 ───

  /** 加载磁盘原始数据（含 taskId），不存在或损坏返回 null */
  private async loadPersisted(sessionId: string): Promise<PersistedMessage[] | null> {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as PersistedMessage[];
    } catch {
      return null;
    }
  }

  // ─── 消息持久化（无 taskId，兼容旧调用） ───

  async saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const filePath = this.sessionPath(sessionId);
    const nonSystem = messages.filter((m) => m.role !== "system");
    if (nonSystem.length === 0) return;
    await fs.promises.writeFile(filePath, JSON.stringify(nonSystem, null, 2), "utf-8");
  }

  async loadMessages(sessionId: string): Promise<ChatMessage[] | null> {
    const raw = await this.loadPersisted(sessionId);
    if (!raw) return null;
    // 剥掉 taskId，返回标准 ChatMessage[]
    return raw.map(({ taskId: _, ...msg }) => msg as ChatMessage);
  }

  // ─── 消息持久化（带 taskId） ───

  async saveMessagesWithTask(
    sessionId: string,
    messages: ChatMessage[],
    currentTaskId: string | null,
    options?: { assignFromIndex?: number },
  ): Promise<void> {
    const filePath = this.sessionPath(sessionId);

    // 加载已有持久化消息（保留已分配的 taskId）
    const existing = await this.loadPersisted(sessionId);
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const persisted: PersistedMessage[] = nonSystemMessages.map((msg, i) => {
      if (options?.assignFromIndex !== undefined && i >= options.assignFromIndex) {
        return { ...msg, taskId: currentTaskId };
      }

      // 已有消息保留原 taskId（老格式无 taskId 属性 → undefined → 用新 taskId 覆盖）
      if (existing && i < existing.length && existing[i].taskId !== undefined) {
        return { ...msg, taskId: existing[i].taskId };
      }
      // 新消息或老格式覆盖：分配当前 taskId
      return { ...msg, taskId: currentTaskId };
    });

    // 只持久化非 system 消息
    if (persisted.length === 0) return;
    await fs.promises.writeFile(filePath, JSON.stringify(persisted, null, 2), "utf-8");
  }

  async getTaskMessages(sessionId: string, taskId: string): Promise<ChatMessage[] | null> {
    const raw = await this.loadPersisted(sessionId);
    if (!raw) return null;

    return raw
      .filter((m) => m.taskId === taskId)
      .map(({ taskId: _, ...msg }) => msg as ChatMessage);
  }

  async listWorkingContextSummaries(
    query: WorkingContextQuery = {},
    taskStore?: FileSystemTaskStore,
  ): Promise<WorkingContextSummary[]> {
    const metas = await this.loadAllMetas();
    const summaries: WorkingContextSummary[] = [];

    for (const meta of metas) {
      const raw = await this.loadPersisted(meta.sessionId);
      if (!raw || raw.length === 0) continue;

      const summary = await this.buildWorkingContextSummary(meta, raw, taskStore);
      if (query.channel && summary.channel !== query.channel) continue;
      if (query.taskId && !summary.taskIds.includes(query.taskId)) continue;
      if (query.kind && query.kind !== "all" && summary.kind !== query.kind) continue;
      summaries.push(summary);
    }

    const limit = clampLimit(query.limit, 50, 1, 200);
    return summaries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  async getWorkingContextDetail(
    contextId: string,
    taskStore?: FileSystemTaskStore,
  ): Promise<WorkingContextDetail | null> {
    if (!isSafeContextId(contextId)) return null;

    const index = await this.readIndex();
    const meta = index[contextId];
    if (!meta) return null;

    const raw = await this.loadPersisted(contextId);
    if (!raw) return null;

    const summary = await this.buildWorkingContextSummary(meta, raw, taskStore);
    const messages = toWorkingContextMessages(raw);
    const health = buildContextHealth(summary);

    return { summary, messages, health };
  }

  // ─── 元信息索引 ───

  async saveMeta(sessionId: string, meta: SessionMeta): Promise<void> {
    const index = await this.readIndex();
    index[sessionId] = meta;
    await this.writeIndex(index);
  }

  async loadAllMetas(): Promise<SessionMeta[]> {
    const index = await this.readIndex();
    return Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async readIndex(): Promise<Record<string, SessionMeta>> {
    const p = this.indexPath();
    if (!fs.existsSync(p)) return {};
    try {
      const raw = await fs.promises.readFile(p, "utf-8");
      return JSON.parse(raw) as Record<string, SessionMeta>;
    } catch {
      return {};
    }
  }

  private async writeIndex(index: Record<string, SessionMeta>): Promise<void> {
    await fs.promises.writeFile(this.indexPath(), JSON.stringify(index, null, 2), "utf-8");
  }

  // ─── 清理 ───

  async removeSession(sessionId: string): Promise<void> {
    const filePath = this.sessionPath(sessionId);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    const index = await this.readIndex();
    delete index[sessionId];
    await this.writeIndex(index);
  }

  private async buildWorkingContextSummary(
    meta: SessionMeta,
    raw: PersistedMessage[],
    taskStore?: FileSystemTaskStore,
  ): Promise<WorkingContextSummary> {
    const taskIds = unique(raw.map((message) => message.taskId).filter(isString));
    const currentTaskId = taskIds[taskIds.length - 1];
    const channel = parseChannel(meta);
    const conversationId = parseConversationId(meta);
    const taskRefs = await resolveTaskRefs(taskIds, taskStore);
    const title = await resolveContextTitle(raw, taskIds, taskStore);
    const lastMessagePreview = resolveLastMessagePreview(raw);
    const userMessageCount = raw.filter((message) => message.role === "user" && hasContent(message)).length;
    const assistantMessageCount = raw.filter((message) => message.role === "assistant" && hasContent(message)).length;

    return {
      contextId: meta.sessionId,
      sessionId: meta.sessionId,
      conversationId,
      channel,
      agentType: meta.agentType,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      messageCount: raw.length,
      userMessageCount,
      assistantMessageCount,
      taskIds,
      taskRefs,
      currentTaskId,
      kind: taskIds.length > 0 ? "task_related" : "temporary",
      title,
      lastMessagePreview,
    };
  }
}

function parseChannel(meta: SessionMeta): RuntimeChannel {
  const raw = meta.channel || meta.sessionId.split(":")[0] || "web";
  if (raw === "cli" || raw === "feishu" || raw === "wechat" || raw === "web" || raw === "qq") {
    return raw;
  }
  return "web";
}

function parseConversationId(meta: SessionMeta): string {
  const prefix = `${meta.channel}:`;
  if (meta.channel && meta.sessionId.startsWith(prefix)) {
    return meta.sessionId.slice(prefix.length);
  }
  const index = meta.sessionId.indexOf(":");
  return index >= 0 ? meta.sessionId.slice(index + 1) : meta.sessionId;
}

function toWorkingContextMessages(raw: PersistedMessage[]): WorkingContextMessage[] {
  return raw
    .filter((message) => (message.role === "user" || message.role === "assistant") && hasContent(message))
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content ?? "",
      taskId: message.taskId ?? null,
    }));
}

async function resolveContextTitle(
  raw: PersistedMessage[],
  taskIds: string[],
  taskStore?: FileSystemTaskStore,
): Promise<string> {
  const latestTaskId = taskIds[taskIds.length - 1];
  if (latestTaskId && taskStore) {
    const task = await taskStore.getTask(latestTaskId).catch(() => null);
    if (task?.title) return task.title;
  }

  const firstUser = raw.find((message) => message.role === "user" && hasContent(message));
  if (firstUser?.content) return preview(firstUser.content, 36);
  return "未命名工作上下文";
}

async function resolveTaskRefs(
  taskIds: string[],
  taskStore?: FileSystemTaskStore,
): Promise<WorkingContextSummary["taskRefs"]> {
  if (!taskStore) return taskIds.map((id) => ({ id }));

  const refs: WorkingContextSummary["taskRefs"] = [];
  for (const id of taskIds) {
    const task = await taskStore.getTask(id).catch(() => null);
    refs.push({
      id,
      title: task?.title,
      status: task?.status,
    });
  }
  return refs;
}

function resolveLastMessagePreview(raw: PersistedMessage[]): string | undefined {
  const latest = [...raw].reverse().find((message) =>
    (message.role === "user" || message.role === "assistant") && hasContent(message),
  );
  return latest?.content ? preview(latest.content, 80) : undefined;
}

function buildContextHealth(summary: WorkingContextSummary): WorkingContextDetail["health"] {
  const estimatedContextLoad =
    summary.messageCount >= 60 ? "high" :
    summary.messageCount >= 20 ? "medium" : "low";
  const warnings = estimatedContextLoad === "high"
    ? [{ kind: "long_context" as const, message: "当前工作上下文较长，必要时应从任务摘要或记忆恢复后继续。" }]
    : [];

  return {
    contextId: summary.contextId,
    messageCount: summary.messageCount,
    estimatedContextLoad,
    activeTaskId: summary.currentTaskId,
    recentTaskIds: summary.taskIds.slice(-5),
    hasRecentSummary: false,
    memoryInjected: false,
    warnings,
  };
}

function hasContent(message: PersistedMessage): boolean {
  return typeof message.content === "string" && message.content.trim().length > 0;
}

function preview(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}...` : compact;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function clampLimit(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isSafeContextId(value: string): boolean {
  return /^[A-Za-z0-9._:@-]+$/.test(value);
}
