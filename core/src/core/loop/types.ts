import type { ChatMessage, ToolDefinition } from "../../llm/types";
import type { SerializedError } from "../../utils/diagnostics";

// ─── Agent 与 Session 元信息 ───

/** Agent 类型的最小配置模板 */
export interface AgentProfile {
  /** 标识，对应 SessionMeta.agentType */
  type: string;
  /** 展示名 */
  name?: string;
  /** 该 agent 使用的系统提示词 */
  systemPrompt?: string;
  /** 该 agent 默认允许的工具列表（不传则全部可用） */
  allowedTools?: string[];
}

/** Session 元信息（不含运行时状态，仅描述"这个会话是什么"） */
export interface SessionMeta {
  sessionId: string;
  /** 来源渠道，如 "cli" / "wechat" / "api" */
  channel: string;
  /** 绑定的 agent 类型，对应 AgentProfile.type */
  agentType: string;
  /** 会话主题（可选，用于分类检索） */
  topic?: string;
  /** 外部系统 ID（可选，用于对接外部渠道的消息 ID） */
  externalId?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── 工具相关 ───

/** 工具执行器：接收工具名称和参数，返回执行结果字符串 */
export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<string>;

/** 注册的工具：定义 + 执行器 */
export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export interface LoopConfig {
  /** 系统提示词 */
  systemPrompt?: string;
  /** 每次 LLM 调用的最大 token */
  maxTokens?: number;
  /** 最大工具调用轮次（防止死循环） */
  maxToolRounds?: number;
  /** 最大工具调用次数（防止单轮批量 tool call 失控） */
  maxToolCalls?: number;
  /** 发给模型的非 system 历史消息窗口；<=0 表示不裁剪 */
  maxContextMessages?: number;
}

/** 本轮对话结束原因 */
export type FinishReason = "final" | "max_tool_rounds" | "max_tool_calls" | "tool_error" | "empty_response";

/** turn() 的可选参数 */
export interface TurnOptions {
  /** 本轮允许暴露的工具名列表（不传则暴露全部） */
  allowedTools?: string[];
}

/** 单轮对话的产物 */
export interface TurnResult {
  /** LLM 最终产出的文本回复（工具循环结束后） */
  text: string;
  /** 本轮完整的消息历史（新增部分） */
  messages: ChatMessage[];
  /** 工具调用记录 */
  toolRounds: ToolRound[];
  /** 本轮结束原因 */
  finishReason: FinishReason;
  /** 本轮总耗时（毫秒） */
  latencyMs: number;
  /** 累计 token 用量 */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: SerializedError;
  diagnostics?: TurnDiagnostics;
}

export interface TurnDiagnostics {
  maxToolRounds?: MaxToolRoundsDiagnostic;
  maxToolCalls?: MaxToolCallsDiagnostic;
}

export interface MaxToolRoundsDiagnostic {
  maxToolRounds: number;
  completedRounds: number;
  totalToolCalls: number;
  lastToolCalls: string[];
  repeatedTools: Array<{ toolName: string; count: number }>;
  likelyCause: string;
  recommendedMode?: "command_only" | "inspect_only" | "edit_files" | "implement_feature" | "verify";
  needsCheckpoint: boolean;
  suggestedAction: string;
}

export interface MaxToolCallsDiagnostic {
  maxToolCalls: number;
  attemptedToolCalls: number;
  executedToolCalls: number;
  skippedToolCalls: number;
  lastToolCalls: string[];
  suggestedAction: string;
}

export interface ToolRound {
  toolCalls: { name: string; args: Record<string, unknown> }[];
  results: string[];
}
