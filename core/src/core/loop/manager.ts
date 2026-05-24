import type { LLMAdapter } from "../../llm/adapter";
import type { ChatMessage } from "../../llm/types";
import { Loop } from "./loop";
import type { LoopConfig, AgentProfile, SessionMeta, TurnResult, ToolHandler } from "./types";
import type { SessionStore } from "./session-store";

/** manager 内部存储单元：Loop + 元信息 + profile */
export interface SessionEntry {
  loop: Loop;
  meta: SessionMeta;
  profile: AgentProfile;
}

export class LoopManager {
  private sessions = new Map<string, SessionEntry>();
  private adapter: LLMAdapter;
  private defaultConfig: LoopConfig;
  private profiles = new Map<string, AgentProfile>();
  private sessionStore: SessionStore | null;

  /** 按 agentType 存储工具模板（创建 session 时自动注册） */
  private toolTemplates = new Map<string, {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: ToolHandler;
  }[]>();

  constructor(adapter: LLMAdapter, defaultConfig: LoopConfig = {}, sessionStore?: SessionStore) {
    this.adapter = adapter;
    this.defaultConfig = defaultConfig;
    this.sessionStore = sessionStore ?? null;
  }

  // ─── Profile 管理 ───

  /** 注册 AgentProfile 模板 */
  registerProfile(profile: AgentProfile): void {
    this.profiles.set(profile.type, profile);
  }

  /** 按 agentType 查找 profile */
  getProfile(type: string): AgentProfile | undefined {
    return this.profiles.get(type);
  }

  /**
   * 按 agentType 注册工具模板。
   * 之后创建该类型的 session 时，工具会自动注册到新 Loop 上。
   */
  registerTool(
    agentType: string,
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: ToolHandler,
  ): void {
    if (!this.toolTemplates.has(agentType)) {
      this.toolTemplates.set(agentType, []);
    }
    this.toolTemplates.get(agentType)!.push({ name, description, parameters, handler });
  }

  // ─── Session 管理 ───

  /** 创建 session（如已存在则覆盖） */
  create(
    sessionId: string,
    channel: string,
    agentType: string,
    options?: { topic?: string; externalId?: string },
  ): SessionEntry {
    const profile = this.resolveProfile(agentType);
    const now = Date.now();
    const meta: SessionMeta = {
      sessionId,
      channel,
      agentType,
      topic: options?.topic,
      externalId: options?.externalId,
      createdAt: now,
      updatedAt: now,
    };

    const loopConfig: LoopConfig = {
      ...this.defaultConfig,
      systemPrompt: profile.systemPrompt ?? this.defaultConfig.systemPrompt,
      maxToolRounds: agentType === "coder" ? 30 : this.defaultConfig.maxToolRounds,
    };
    const loop = new Loop(this.adapter, loopConfig);

    // 自动注册该 agentType 的工具模板
    const templates = this.toolTemplates.get(agentType);
    if (templates) {
      for (const t of templates) {
        loop.registerTool(t.name, t.description, t.parameters, t.handler);
      }
    }

    const entry: SessionEntry = { loop, meta, profile };
    this.sessions.set(sessionId, entry);
    return entry;
  }

  /** 获取 session（不存在则返回 undefined） */
  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  /** 获取或创建 session */
  getOrCreate(
    sessionId: string,
    channel: string,
    agentType: string,
    options?: { topic?: string; externalId?: string },
  ): SessionEntry {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    return this.create(sessionId, channel, agentType, options);
  }

  /** 直接获取底层 Loop（用于注册工具等操作） */
  getLoop(sessionId: string): Loop | undefined {
    return this.sessions.get(sessionId)?.loop;
  }

  /** 获取 session meta */
  getMeta(sessionId: string): SessionMeta | undefined {
    return this.sessions.get(sessionId)?.meta;
  }

  /** 列出所有 session 概览（按更新时间降序） */
  list(): SessionMeta[] {
    return Array.from(this.sessions.values(), (e) => e.meta).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  /** 重置指定 session 的对话历史 */
  reset(sessionId: string): void {
    this.sessions.get(sessionId)?.loop.reset();
  }

  /** 删除指定 session */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.sessionStore) {
      this.sessionStore.removeSession(sessionId).catch(() => {});
    }
  }

  /** 检查 session 是否存在 */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** 当前 session 数量 */
  get size(): number {
    return this.sessions.size;
  }

  // ─── Turn 执行 ───

  /** 按 session 执行 turn，自动应用 profile.allowedTools */
  async turn(
    sessionId: string,
    userInput: string,
    taskId?: string | null,
    options?: { persist?: boolean },
  ): Promise<TurnResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);

    entry.meta.updatedAt = Date.now();
    const allowedTools = entry.profile.allowedTools;
    const result = await entry.loop.turn(userInput, allowedTools ? { allowedTools } : undefined);

    // 自动保存到持久化存储（不阻塞返回）
    if (this.sessionStore && options?.persist !== false) {
      const messages = entry.loop.getMessages();
      if (taskId !== undefined) {
        this.sessionStore.saveMessagesWithTask(sessionId, messages, taskId ?? null).catch(() => {});
      } else {
        this.sessionStore.saveMessages(sessionId, messages).catch(() => {});
      }
      this.sessionStore.saveMeta(sessionId, entry.meta).catch(() => {});
    }

    return result;
  }

  async persistMessagesWithTask(
    sessionId: string,
    taskId: string | null,
    options?: { assignFromIndex?: number },
  ): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
    if (!this.sessionStore) return;

    await this.sessionStore.saveMessagesWithTask(sessionId, entry.loop.getMessages(), taskId, options);
    await this.sessionStore.saveMeta(sessionId, entry.meta);
  }

  /** 获取指定任务的全部消息（从持久化存储） */
  getTaskMessages(sessionId: string, taskId: string): Promise<ChatMessage[] | null> {
    if (!this.sessionStore) return Promise.resolve(null);
    return this.sessionStore.getTaskMessages(sessionId, taskId);
  }

  /** 从持久化存储恢复所有已知 session 的对话历史 */
  async preloadSessions(): Promise<void> {
    if (!this.sessionStore) return;

    try {
      const metas = await this.sessionStore.loadAllMetas();
      for (const meta of metas) {
        // 跳过已在内存中的
        if (this.sessions.has(meta.sessionId)) continue;

        const messages = await this.sessionStore.loadMessages(meta.sessionId);
        if (!messages || messages.length === 0) continue;

        // 重建 session
        const entry = this.create(meta.sessionId, meta.channel, meta.agentType, {
          topic: meta.topic,
          externalId: meta.externalId,
        });
        entry.loop.restoreMessages(messages);
        entry.meta = { ...meta, updatedAt: Date.now() };
      }
      console.log(
        `[${new Date().toISOString()}] 会话持久化: 已从磁盘恢复 ${metas.length} 个 session`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] 会话恢复失败: ${msg}`);
    }
  }

  // ─── 内部 ───

  private resolveProfile(agentType: string): AgentProfile {
    const profile = this.profiles.get(agentType);
    if (profile) return profile;

    // 未注册的 agentType 使用默认空 profile
    return { type: agentType };
  }
}
