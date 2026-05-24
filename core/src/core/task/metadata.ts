// ═══════════════════════════════════════════════
// TaskMetadataService
//
// 职责：后台结构化任务元信息生成
//   - title（6-20 字中文简短标题）
//   - goal（1-2 句话的用户目标）
//   - summary（2-4 句话的任务进展总结）
//   - todos（后续待办列表）
//   - outcome（任务成果）
//
// 约束：
//   - 不直接回复用户
//   - 不调用业务工具
//   - 强制 JSON 输出
//   - 生成失败时返回空 draft，不抛异常
//
// 模型选择：
//   - 优先使用 LLM_META_MODEL 环境变量
//   - 未配置时复用 LLM_MODEL
// ═══════════════════════════════════════════════

import type { LLMAdapter } from "../../llm/adapter";
import type { ChatMessage } from "../../llm/types";

// ─── 类型 ───

export interface TaskMetadataDraft {
  title?: string;
  goal?: string;
  summary?: string;
  todos?: string[];
  outcome?: string;
}

interface JsonResponse {
  title?: string;
  goal?: string;
  summary?: string;
  todos?: string[];
  outcome?: string;
}

// ─── Service ───

export class TaskMetadataService {
  private adapter: LLMAdapter;
  private model: string;

  constructor(adapter: LLMAdapter, options?: { model?: string }) {
    this.adapter = adapter;
    this.model = options?.model ?? process.env.LLM_META_MODEL ?? process.env.LLM_MODEL ?? "glm-5";
  }

  // ─── 公开方法 ───

  /** 首轮对话后生成初始 title + goal */
  async generateInitialMetadata(input: {
    firstUserMessage: string;
    assistantReply: string;
  }): Promise<TaskMetadataDraft> {
    const systemPrompt =
      "你是一个任务元数据生成助手。根据用户和助手的对话，生成任务标题和目标的 JSON。只输出有效 JSON，不要输出任何其他文本、代码块标记或注释。";

    const userPrompt = [
      `用户消息：${input.firstUserMessage}`,
      `助手回复：${input.assistantReply.slice(0, 300)}`,
      "",
      '输出格式（严格遵守）：{"title":"简短中文标题(6-20字)","goal":"用户的核心目标(1-2句话)"}',
      "",
      "title 要求：6-20字中文，概括用户核心意图，不要引号、不要完整长句、不要带标点。",
      "goal 要求：1-2句话描述用户想达成的目标。",
    ].join("\n");

    return this.call(userPrompt, systemPrompt, ["title", "goal"]);
  }

  /** 用户要求总结时汇总当前任务 */
  async summarizeTask(input: {
    title: string;
    goal?: string;
    conversationContext: string[];
  }): Promise<TaskMetadataDraft> {
    const systemPrompt =
      "你是一个任务总结助手。根据任务信息和完整对话记录，生成进展总结和待办列表的 JSON。只输出有效 JSON，不要输出任何其他文本、代码块标记或注释。";

    const context = input.conversationContext.join("\n");

    const userPrompt = [
      `任务标题：${input.title}`,
      input.goal ? `任务目标：${input.goal}` : "",
      "",
      "## 对话记录（用户、助手、工具交互）",
      context || "（无记录）",
      "",
      '输出格式（严格遵守）：{"summary":"任务进展总结(2-4句话)","todos":["后续待办1","后续待办2"]}',
      "",
      "summary 要求：2-4句话，概括已做了什么、当前状态、下一步方向。",
      "todos 要求：2-5个具体可执行的后续步骤，如无则返回空数组。",
    ].join("\n");

    return this.call(userPrompt, systemPrompt, ["summary", "todos"]);
  }

  /** 任务完成时生成 outcome 和最终 summary */
  async finalizeTask(input: {
    title: string;
    goal?: string;
    conversationContext: string[];
    assistantSummary?: string;
  }): Promise<TaskMetadataDraft> {
    const systemPrompt =
      "你是一个任务结项助手。根据任务信息和完整对话记录生成最终总结、成果和遗留待办的 JSON。只输出有效 JSON，不要输出任何其他文本、代码块标记或注释。";

    const context = input.conversationContext.join("\n");

    const userPrompt = [
      `任务标题：${input.title}`,
      input.goal ? `任务目标：${input.goal}` : "",
      input.assistantSummary ? `助手之前总结：${input.assistantSummary}` : "",
      "",
      "## 完整对话记录（用户、助手、工具交互及 AgentRun 摘要）",
      context || "（无记录）",
      "",
      "对话记录中可能包含 AgentRun 摘要。AgentRun 是当前任务内部委托给子 Agent 的执行过程，其 Summary/Output/Todos/Error 应纳入最终 summary/outcome/todos 判断。",
      "",
      '输出格式（严格遵守）：{"summary":"最终任务总结(2-4句话)","outcome":"任务成果(1-2句话)","todos":["如有遗留待办"]}',
      "",
      "summary 要求：必须包含实际执行过程的关键信息、关键决策点，不能只说「任务已完成」。",
      "outcome 要求：对照目标描述实际成果，有偏差要明确说明。",
      "todos 要求：如有未完成的后续步骤列出，已完成的任务不要列。如无遗留则返回空数组。",
    ].join("\n");

    return this.call(userPrompt, systemPrompt, ["summary", "outcome", "todos"]);
  }

  // ─── 内部 ───

  private async call(
    userPrompt: string,
    systemPrompt: string,
    _expectedFields: string[],
  ): Promise<TaskMetadataDraft> {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      const response = await this.adapter.chat({
        messages,
        temperature: 0.3,
        maxTokens: 600,
        model: this.model,
        responseFormat: { type: "json_object" },
      });

      const text = response.message.content;
      if (!text) return {};

      return this.parseResponse(text);
    } catch (err) {
      // 静默失败，返回空 draft
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TaskMetadataService] 生成失败: ${msg.slice(0, 120)}`);
      return {};
    }
  }

  private parseResponse(text: string): TaskMetadataDraft {
    let json: JsonResponse;
    try {
      json = JSON.parse(text) as JsonResponse;
    } catch {
      // 尝试从 markdown 代码块中提取 JSON
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock?.[1]) {
        try {
          json = JSON.parse(codeBlock[1].trim()) as JsonResponse;
        } catch {
          return {};
        }
      } else {
        return {};
      }
    }

    const draft: TaskMetadataDraft = {};

    if (typeof json.title === "string" && json.title.trim().length > 0) {
      draft.title = this.cleanTitle(json.title);
    }
    if (typeof json.goal === "string" && json.goal.trim().length > 0) {
      draft.goal = json.goal.trim();
    }
    if (typeof json.summary === "string" && json.summary.trim().length > 0) {
      draft.summary = json.summary.trim();
    }
    if (typeof json.outcome === "string" && json.outcome.trim().length > 0) {
      draft.outcome = json.outcome.trim();
    }
    if (Array.isArray(json.todos)) {
      draft.todos = json.todos.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }

    return draft;
  }

  /** 清理 title：去引号、去标点、截断过长 */
  private cleanTitle(title: string): string {
    let cleaned = title
      .replace(/^["「『【《‹〈「『]/, "")
      .replace(/["」』】》›〉」』]$/, "")
      .replace(/[。，！？、；：""''（）]/g, "")
      .trim();

    if (cleaned.length > 20) {
      cleaned = cleaned.slice(0, 20) + "…";
    }
    return cleaned || title.slice(0, 20);
  }
}
