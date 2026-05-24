import type {
  FileAttachment,
  IncomingMessage,
  TaskProcessResult,
  TaskSession,
  TaskStatus,
} from "../task";
import type {
  DailyDigest,
  MemoryAtom,
  MemoryAtomFilter,
  MemoryCandidate,
  MemoryCandidateFilter,
  MemoryScope,
} from "../memory";

export type RuntimeChannel = IncomingMessage["channel"];

export interface RuntimeEnvelope {
  channel: RuntimeChannel;
  userId: string;
  conversationId: string;
  text: string;
  timestamp: number;
  agentHint?: string;
  files?: FileAttachment[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeResponse {
  text: string;
  taskId?: string;
  taskStatus: TaskStatus | "none";
  usage?: TaskProcessResult["usage"];
  latencyMs: number;
  replyFiles?: FileAttachment[];
  events?: RuntimeEvent[];
  rawResult: TaskProcessResult;
}

export interface RuntimeContinuationDecision {
  decision: "auto_continue" | "ask_user" | "stop_and_report";
  reason: string;
  confidence: number;
  nextAgentType?: "coder" | "researcher" | "writer";
  nextPhase?: "inspect_only" | "edit_files" | "verify" | "command_only" | "implement_feature";
  /** @deprecated Use nextPhase. */
  nextMode?: "inspect_only" | "edit_files" | "verify" | "command_only" | "implement_feature";
  nextInstruction?: string;
  requiresPermission?: boolean;
  userVisibleSummary: string;
}

export type RuntimeEvent =
  | { type: "assistant_message"; text: string; visibility: "user" | "internal"; at: number }
  | { type: "tool_call_started"; toolName: string; at: number }
  | { type: "tool_call_finished"; toolName: string; resultPreview: string; at: number }
  | { type: "agent_run_started"; agentType: string; mode?: string; runId: string; at: number }
  | { type: "agent_run_finished"; runId: string; status: string; summary?: string; at: number }
  | { type: "continuation_decision"; decision: RuntimeContinuationDecision; at: number }
  | { type: "final"; text: string; at: number };

export interface RuntimeSleepOptions {
  dateKey?: string;
}

export interface RuntimeSleepResult {
  dateKey: string;
  digest: DailyDigest;
}

export interface RuntimeStatus {
  startedAt: number;
  uptimeMs: number;
  dataDir: string;
  projectRoot: string;
  runtimeMode: "local-dev" | "production";
  sessionsLoaded: number;
  llmEnabled: boolean;
}

export interface WorkingContextQuery {
  channel?: RuntimeChannel;
  userId?: string;
  taskId?: string;
  kind?: "task_related" | "temporary" | "all";
  limit?: number;
}

export interface WorkingContextSummary {
  contextId: string;
  sessionId: string;
  conversationId: string;
  channel: RuntimeChannel;
  agentType: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  taskIds: string[];
  taskRefs: WorkingContextTaskRef[];
  currentTaskId?: string;
  kind: "task_related" | "temporary";
  title: string;
  lastMessagePreview?: string;
}

export interface WorkingContextTaskRef {
  id: string;
  title?: string;
  status?: TaskStatus;
}

export interface WorkingContextMessage {
  role: "user" | "assistant";
  content: string;
  taskId?: string | null;
  createdAt?: number;
}

export interface ContextHealthWarning {
  kind: "long_context" | "topic_drift" | "missing_project_detail" | "stale_verification";
  message: string;
}

export interface ContextHealth {
  contextId: string;
  messageCount: number;
  estimatedContextLoad: "low" | "medium" | "high";
  activeTaskId?: string;
  recentTaskIds: string[];
  hasRecentSummary: boolean;
  memoryInjected: boolean;
  warnings: ContextHealthWarning[];
}

export interface WorkingContextDetail {
  summary: WorkingContextSummary;
  messages: WorkingContextMessage[];
  health?: ContextHealth;
}

export interface TaskQuery {
  status?: TaskStatus;
}

export interface RuntimeScope extends MemoryScope {
  channel?: RuntimeChannel;
  conversationId?: string;
}

export type MemoryQuery = MemoryAtomFilter;
export type MemoryCandidateQuery = MemoryCandidateFilter;
export type TaskView = TaskSession;
export type MemoryAtomView = MemoryAtom;
export type MemoryCandidateView = MemoryCandidate;

export interface AugustusRuntime {
  start(): Promise<void>;
  receive(input: RuntimeEnvelope): Promise<RuntimeResponse>;
  sleep(options?: RuntimeSleepOptions): Promise<RuntimeSleepResult>;
  getStatus(): Promise<RuntimeStatus>;
  listTasks(query?: TaskQuery): Promise<TaskView[]>;
  getCurrentTask(scope: RuntimeScope): Promise<TaskView | null>;
  listWorkingContexts(query?: WorkingContextQuery): Promise<WorkingContextSummary[]>;
  getWorkingContext(contextId: string): Promise<WorkingContextDetail | null>;
  listMemoryAtoms(query?: MemoryQuery): Promise<MemoryAtomView[]>;
  listMemoryCandidates(query?: MemoryCandidateQuery): Promise<MemoryCandidateView[]>;
}
