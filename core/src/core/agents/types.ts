// ═══════════════════════════════════════════════
// AgentProfile / AgentRun 核心类型定义
//
// AgentProfile 是角色配置（不是运行实例），描述：
//   - 这个 Agent 是谁、负责什么
//   - 使用哪个 provider 和 model
//   - 允许使用哪些工具
//   - system prompt 和输出契约
//
// AgentRun 是某次 AgentProfile 在某个 Task 下的执行记录，
// 用于观测、调试和总结。
// ═══════════════════════════════════════════════

export type LLMProviderType = "anthropic" | "openai";

// ─── AgentProfile ───

export interface AgentProfile {
  /** 标识符，如 "main" / "coder" / "researcher" / "writer" */
  type: string;
  /** 展示名称 */
  name: string;
  /** 一句话描述 */
  description?: string;

  /** LLM 协议 */
  provider: LLMProviderType;
  /** 模型名（如 claude-sonnet-4-6 / deepseek-chat / gpt-4.1） */
  model: string;
  /** 自定义 API endpoint，未设置时复用 LLM_BASE_URL */
  baseURL?: string;
  /** 读取 API key 的环境变量名，默认 "LLM_API_KEY" */
  apiKeyEnv?: string;

  /** 系统提示词 */
  systemPrompt: string;
  /** 该 Agent 默认允许的工具名称列表 */
  allowedTools: string[];

  /** 每次 LLM 调用最大 token，默认 4096 */
  maxTokens?: number;
  /** 最大工具调用轮次，默认 30 */
  maxToolRounds?: number;
  /** 采样温度 */
  temperature?: number;

  /** 输出格式契约，描述该 Agent 应该如何结构化返回结果 */
  outputContract?: string;
}

// ─── AgentRun ───

export type AgentRunStatus = "running" | "done" | "failed";

export type AgentRunOutcome =
  | "done"
  | "needs_permission"
  | "needs_continuation"
  | "needs_user_decision"
  | "blocked"
  | "failed";

// ─── Agent Run Phase ───

export type AgentRunPhase =
  | "default"
  | "command_only"
  | "inspect_only"
  | "edit_files"
  | "implement_feature"
  | "verify";

/** @deprecated Use AgentRunPhase / phase. */
export type AgentRunMode = AgentRunPhase;

export interface AgentToolEvent {
  /** 事件发生时间戳 */
  at: number;
  /** 工具名称 */
  toolName: string;
  /** 参数摘要 */
  argsSummary?: string;
  /** 结果摘要 */
  resultSummary?: string;
  /** 工具执行是否成功 */
  success: boolean;
}

export interface ContinuationPack {
  runId: string;
  taskId: string;
  agentType: string;
  phase?: AgentRunPhase;
  /** @deprecated Use phase. */
  mode?: AgentRunPhase;
  completedSteps: string[];
  touchedFiles: string[];
  observations: string[];
  failedAttempts: string[];
  lastToolResults: string[];
  recommendedNextMode?: AgentRunMode;
  recommendedNextPhase?: AgentRunPhase;
  recommendedNextInstruction?: string;
  requiresPermission?: boolean;
  openQuestions?: string[];
}

export interface AgentRunResult {
  /** 人类可读的执行摘要 */
  summary: string;
  /** 完整输出文本 */
  output: string;
  /** 产物引用 */
  artifacts?: Array<{
    type: string;
    uri: string;
    description?: string;
  }>;
  /** 执行过程中的关键决策 */
  decisions?: string[];
  /** 遗留待办 */
  todos?: string[];
}

export interface AgentRun {
  /** 运行 ID，如 "run_001_coder" */
  id: string;
  /** 所属 Task ID */
  taskId: string;

  /** 对应 AgentProfile.type */
  agentType: string;
  /** 本次执行阶段，用于规划顺序、裁剪工具能力和设置工具预算 */
  phase?: AgentRunPhase;
  /** @deprecated Use phase. */
  mode?: AgentRunPhase;
  /** 本次实际使用的 provider */
  provider: LLMProviderType;
  /** 本次实际使用的 model */
  model: string;

  status: AgentRunStatus;
  outcome?: AgentRunOutcome;

  /** 主 Agent 给出的委托指令 */
  instruction: string;
  /** 主 Agent 给出的精简上下文摘要 */
  contextSummary?: string;
  /** 期望的输出形式 */
  expectedOutput?: string;

  startedAt: number;
  endedAt?: number;

  /** 本次执行中实际使用过的工具名列表 */
  usedTools: string[];
  /** 工具调用事件记录 */
  toolEvents: AgentToolEvent[];

  result?: AgentRunResult;
  continuationPack?: ContinuationPack;
  error?: string;
}

// ─── AgentRun 输入 ───

export interface AgentRunRequest {
  taskId: string;
  agentType: string;
  phase?: AgentRunPhase;
  /** @deprecated Use phase. */
  mode?: AgentRunPhase;
  instruction: string;
  context?: string;
  expectedOutput?: string;
}

// ─── Task-scoped Agent Thread ───

export interface AgentThreadRunSummary {
  runId: string;
  status: AgentRunStatus;
  outcome?: AgentRunOutcome;
  phase?: AgentRunPhase;
  /** @deprecated Use phase. */
  mode?: AgentRunPhase;
  instruction: string;
  summary?: string;
  error?: string;
  usedTools: string[];
  toolEventCount: number;
  startedAt: number;
  endedAt?: number;
}

export interface TaskAgentThread {
  taskId: string;
  agentType: string;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastRunId?: string;
  recentRuns: AgentThreadRunSummary[];
  completedSteps: string[];
  failedAttempts: string[];
  verificationNotes: string[];
  openQuestions: string[];
}
