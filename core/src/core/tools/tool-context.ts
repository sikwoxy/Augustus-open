import type { AgentRunner } from "../agents/runner";
import type { FileSystemTaskStore } from "../task/store";
import type { ImplementationCheckpointStore } from "../task/implementation-checkpoint-store";
import type { WorkspaceGrantStore } from "../task/workspace-grant-store";
import type { FileAttachment, IncomingMessage, TaskSession } from "../task/types";

export type AugustusRuntimeMode = "local-dev" | "production";

export interface ToolRuntimeContext {
  dataDir: string;
  projectRoot: string;
  runtimeMode?: AugustusRuntimeMode;
  taskStore?: FileSystemTaskStore;
  workspaceGrantStore?: WorkspaceGrantStore;
  implementationCheckpointStore?: ImplementationCheckpointStore;
  getCurrentContext?: () => {
    userId: string;
    channel: IncomingMessage["channel"];
    conversationId: string;
  } | undefined;
  addReplyFile?: (file: FileAttachment) => void;
  getAgentRunner?: () => AgentRunner | null | undefined;
  onTaskCompleted?: (task: TaskSession, assistantSummary?: string) => void | Promise<void>;
}
