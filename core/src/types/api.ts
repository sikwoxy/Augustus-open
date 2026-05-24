// ═══════════════════════════════════════════════
// Augustus API Contract
//
// 前后端共享的 HTTP API 类型定义。
// 前端小弟按这些类型写 typed client 和 mock。
// ═══════════════════════════════════════════════

import type { TaskStatus, TaskChannelRef, TaskArtifact } from "../core/task/types";
import type {
  RuntimeEvent,
  WorkingContextDetail,
  WorkingContextSummary,
} from "../core/runtime/types";

// ─── 通用响应 ───

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "RUNTIME_ERROR"
  | "LLM_NOT_CONFIGURED"
  | "TASK_NOT_FOUND"
  | "REQUEST_TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "CONTEXT_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ApiSuccess<T> {
  ok: true;
  requestId: string;
  data: T;
}

export interface ApiError {
  ok: false;
  requestId: string;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Health ───

export interface HealthResponse {
  status: "ok";
}

export interface ReadyCheck {
  name: string;
  ok: boolean;
  message?: string;
}

export interface ReadyResponse {
  ready: boolean;
  checks: ReadyCheck[];
}

// ─── Status ───

export interface StatusResponse {
  startedAt: number;
  uptimeMs: number;
  dataDir: string;
  projectRoot: string;
  runtimeMode?: "local-dev" | "production";
  sessionsLoaded: number;
  llmEnabled: boolean;
  version?: string;
}

// ─── Chat ───

export interface ChatRequest {
  channel?: "web" | "cli" | "feishu";
  userId?: string;
  conversationId: string;
  text: string;
  agentHint?: string;
  files?: Array<{
    fileName: string;
    localPath: string;
    size: number;
    mimeType?: string;
    sourceKey?: string;
    sourceType?: "file" | "image" | "audio" | "video";
  }>;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
  taskId?: string;
  taskStatus: TaskStatus | "none";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  replyFiles?: Array<{
    fileName: string;
    localPath: string;
    size: number;
    mimeType?: string;
    sourceKey?: string;
    sourceType?: "file" | "image" | "audio" | "video";
  }>;
  /** 诊断信息：toolRounds、finishReason、systemPrompt 等，供调试和测试页使用 */
  diagnostics?: Record<string, unknown>;
  /** 未来 streaming/CLI/Web 可用的事件流占位；当前 HTTP 路径可为空 */
  events?: RuntimeEvent[];
}

// ─── Task ───

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  goal?: string;
  summary?: string;
  updatedAt: number;
  createdAt: number;
  ownerUserId: string;
  channels: TaskChannelRef[];
  todos?: string[];
  artifacts?: TaskArtifact[];
}

export interface TaskListResponse {
  tasks: TaskSummary[];
}

export interface TaskDetailResponse {
  task: TaskSummary & {
    outcome?: string;
    decisions?: string[];
    usedAgents?: string[];
    skills?: string[];
    verificationState?: unknown;
  };
}

// ─── Working Context ───

export interface ContextListResponse {
  contexts: WorkingContextSummary[];
}

export interface ContextDetailResponse {
  context: WorkingContextDetail;
}

// ─── Sleep ───

export interface SleepResponse {
  dateKey: string;
}
