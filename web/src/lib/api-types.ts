// ═══════════════════════════════════════════════
// API Contract Types
//
// 所有 HTTP API 类型从 @augustus/core 导入。
// 前端组件通过本文件间接引用，不直接依赖 core。
// ═══════════════════════════════════════════════

export type {
  ApiErrorCode,
  ApiResponse,
  ChatRequest,
  ChatResponse,
  TaskStatus,
  TaskSummary,
  TaskListResponse,
  TaskDetailResponse,
  WorkingContextSummary,
  WorkingContextTaskRef,
  WorkingContextMessage,
  ContextHealth,
  WorkingContextDetail,
  ContextListResponse,
  ContextDetailResponse,
  StatusResponse,
  HealthResponse,
  ReadyResponse,
  SleepResponse,
} from "@augustus/core";

// 前端专用类型（不在 API contract 中）
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
