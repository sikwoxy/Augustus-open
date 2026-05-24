// ═══════════════════════════════════════════════
// Task 层核心类型定义
//
// 设计原则：
//   - TaskSession 是任务容器，身份独立于渠道/agentType
//   - IncomingMessage 是统一的消息入口格式
//   - CurrentTaskPointer 是按 (userId + channel + conversationId) 维度的便利指针
//   - TaskRouteDecision 封装第一版规则路由结果
// ═══════════════════════════════════════════════

// ─── Task Status ───

export type TaskStatus = "active" | "paused" | "done" | "archived";

// ─── Task Channel Ref ───

export interface TaskChannelRef {
  channel: "cli" | "feishu" | "wechat" | "web" | "qq";
  conversationId: string;
  joinedAt: number;
}

// ─── Task Artifact ───

export interface TaskArtifact {
  type: string;
  uri: string;
  description?: string;
  createdAt: number;
}

// ─── Workspace / Project Refs ───

export type WorkspacePermission = "read" | "write" | "execute" | "network";

export interface TaskWorkspaceRef {
  root: string;
  label?: string;
  kind?: "task_workspace" | "runtime" | "frontend" | "external_clone" | "artifact" | "other";
  addedAt: number;
}

export interface WorkspaceGrant {
  taskId: string;
  root: string;
  permissions: WorkspacePermission[];
  destructive: false;
  approvedAt: number;
  approvedBy: string;
  note?: string;
}

// ─── Verification State ───

export type VerificationCheckKey =
  | "build_passed"
  | "typecheck_passed"
  | "tests_passed"
  | "lint_passed"
  | "dev_server_started"
  | "localhost_reachable"
  | "browser_verified"
  | "interaction_verified"
  | "git_diff_checked";

export type VerificationStatus = "passed" | "failed" | "blocked" | "unknown";

export interface TaskVerificationRecord {
  key: VerificationCheckKey;
  label: string;
  status: VerificationStatus;
  verifiedAt: number;
  toolName?: string;
  command?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface TaskVerificationState {
  updatedAt: number;
  records: TaskVerificationRecord[];
  notes?: string[];
}

// ─── Implementation Checkpoint ───

export type ImplementationCheckpointStatus = "pending" | "confirmed" | "cancelled";

export type ImplementationCheckpointRisk = "low" | "medium" | "high";

export interface ImplementationCheckpoint {
  id: string;
  taskId: string;
  status: ImplementationCheckpointStatus;
  workspaceRoot: string;
  actions: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  willInstallDependencies: boolean;
  willCreateOrUpdateLockfile: boolean;
  risk: ImplementationCheckpointRisk;
  question?: string;
  userResponse?: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  confirmedBy?: string;
}

// ─── Task Session ───

export interface TaskSession {
  id: string;
  title: string;
  slug?: string;
  status: TaskStatus;

  goal?: string;
  summary?: string;
  outcome?: string;

  createdAt: number;
  updatedAt: number;
  closedAt?: number;

  ownerUserId: string;

  channels: TaskChannelRef[];

  agentHints?: string[];
  usedAgents?: string[];
  skills?: string[];
  memoryRefs?: string[];
  workspaceRefs?: TaskWorkspaceRef[];
  projectRefs?: string[];

  artifacts?: TaskArtifact[];
  decisions?: string[];
  todos?: string[];
  verificationState?: TaskVerificationState;
  checkpointRefs?: string[];

  /** title 首次后台生成的时间戳，用于防重复生成 */
  titleGeneratedAt?: number;
  /** 最近一次元数据（title/goal/summary/todos）后台生成的时间戳 */
  metadataUpdatedAt?: number;
}

// ─── File Attachment ───

export interface FileAttachment {
  /** 文件名 */
  fileName: string;
  /** 本地文件路径（下载后存储的位置） */
  localPath: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType?: string;
  /** 飞书 file_key / image_key（用于回复引用） */
  sourceKey?: string;
  /** 来源类型 */
  sourceType?: "file" | "image" | "audio" | "video";
}

// ─── Incoming Message ───

export interface IncomingMessage {
  channel: "cli" | "feishu" | "wechat" | "web" | "qq";
  userId: string;
  conversationId: string;
  text: string;
  timestamp: number;
  /** 来自 /cmd 前缀的 agent 提示，如 "coder" */
  agentHint?: string;
  /** 消息附带的文件列表 */
  files?: FileAttachment[];
  /** 透传元数据（如 requestId），不可丢失 */
  metadata?: Record<string, unknown>;
}

// ─── Current Task Pointer ───

export interface CurrentTaskPointer {
  userId: string;
  channel: string;
  conversationId: string;
  taskId: string;
  updatedAt: number;
}

// ─── Task Process Result ───

export interface TaskProcessResult {
  taskId?: string;
  taskStatus: TaskStatus | "none";
  replyText: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  /** 回复中附带发送的文件 */
  replyFiles?: FileAttachment[];
  /** Extra diagnostics for debug logging; not intended for user-facing replies. */
  diagnostics?: Record<string, unknown>;
  /** Internal/user-visible event stream placeholder for future CLI/Web streaming. */
  events?: unknown[];
}
