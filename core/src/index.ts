// ═══════════════════════════════════════════════
// @augustus/core
//
// 公开 API：
//   - 类型：Runtime 接口、API contract
//   - 工厂：createAugustusRuntime()
// ═══════════════════════════════════════════════

// ─── Runtime 工厂 ───

export { createAugustusRuntime } from "./core/runtime/create-runtime";
export { SerialQueue } from "./utils/serial-queue";

// ─── Runtime 公开类型 ───

export type {
  AugustusRuntime,
  RuntimeChannel,
  RuntimeEnvelope,
  RuntimeEvent,
  RuntimeContinuationDecision,
  RuntimeResponse,
  RuntimeStatus,
  RuntimeScope,
  RuntimeSleepOptions,
  RuntimeSleepResult,
  TaskView,
  TaskQuery,
  WorkingContextQuery,
  WorkingContextSummary,
  WorkingContextTaskRef,
  WorkingContextMessage,
  ContextHealthWarning,
  ContextHealth,
  WorkingContextDetail,
} from "./core/runtime/types";

export type { FileAttachment } from "./core/task/types";

// ─── Task 公开类型 ───

export type {
  TaskStatus,
  TaskChannelRef,
  TaskArtifact,
} from "./core/task/types";

// ─── API contract 类型 ───

export type {
  ApiErrorCode,
  ApiSuccess,
  ApiError,
  ApiResponse,
  HealthResponse,
  ReadyCheck,
  ReadyResponse,
  StatusResponse,
  ChatRequest,
  ChatResponse,
  TaskSummary,
  TaskListResponse,
  TaskDetailResponse,
  ContextListResponse,
  ContextDetailResponse,
  SleepResponse,
} from "./types/api";
