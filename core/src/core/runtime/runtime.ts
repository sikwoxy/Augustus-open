import type { LoopManager } from "../loop";
import type { FileSystemSessionStore } from "../loop/session-store";
import type { FileSystemTaskStore, TaskOrchestrator } from "../task";
import type {
  FileSystemMemoryAtomStore,
  FileSystemMemoryCandidateStore,
  MemoryConsolidator,
} from "../memory";
import { formatDateKey } from "../../utils/time-zone";
import type {
  AugustusRuntime,
  MemoryCandidateQuery,
  MemoryQuery,
  RuntimeEnvelope,
  RuntimeEvent,
  RuntimeResponse,
  RuntimeScope,
  RuntimeSleepOptions,
  RuntimeSleepResult,
  RuntimeStatus,
  TaskQuery,
  WorkingContextQuery,
} from "./types";
import type { AugustusRuntimeMode } from "../tools/tool-context";

export interface AugustusRuntimeDependencies {
  dataDir: string;
  projectRoot: string;
  runtimeMode: AugustusRuntimeMode;
  manager: LoopManager;
  sessionStore: FileSystemSessionStore;
  taskStore: FileSystemTaskStore;
  orchestrator: TaskOrchestrator;
  memoryConsolidator: MemoryConsolidator;
  memoryAtomStore: FileSystemMemoryAtomStore;
  memoryCandidateStore: FileSystemMemoryCandidateStore;
}

export class AugustusRuntimeImpl implements AugustusRuntime {
  readonly dataDir: string;
  readonly projectRoot: string;
  readonly runtimeMode: AugustusRuntimeMode;
  readonly manager: LoopManager;

  private readonly startedAt = Date.now();
  private readonly sessionStore: FileSystemSessionStore;
  private readonly taskStore: FileSystemTaskStore;
  private readonly orchestrator: TaskOrchestrator;
  private readonly memoryConsolidator: MemoryConsolidator;
  private readonly memoryAtomStore: FileSystemMemoryAtomStore;
  private readonly memoryCandidateStore: FileSystemMemoryCandidateStore;
  private hasStarted = false;

  constructor(deps: AugustusRuntimeDependencies) {
    this.dataDir = deps.dataDir;
    this.projectRoot = deps.projectRoot;
    this.runtimeMode = deps.runtimeMode;
    this.manager = deps.manager;
    this.sessionStore = deps.sessionStore;
    this.taskStore = deps.taskStore;
    this.orchestrator = deps.orchestrator;
    this.memoryConsolidator = deps.memoryConsolidator;
    this.memoryAtomStore = deps.memoryAtomStore;
    this.memoryCandidateStore = deps.memoryCandidateStore;
  }

  async start(): Promise<void> {
    if (this.hasStarted) return;
    await this.manager.preloadSessions();
    this.hasStarted = true;
  }

  async receive(input: RuntimeEnvelope): Promise<RuntimeResponse> {
    const result = await this.orchestrator.process({
      channel: input.channel,
      userId: input.userId,
      conversationId: input.conversationId,
      text: input.text,
      timestamp: input.timestamp,
      agentHint: input.agentHint,
      files: input.files,
      metadata: input.metadata,
    });

    return {
      text: result.replyText,
      taskId: result.taskId,
      taskStatus: result.taskStatus,
      usage: result.usage,
      latencyMs: result.latencyMs,
      replyFiles: result.replyFiles,
      events: result.events as RuntimeEvent[] | undefined,
      rawResult: result,
    };
  }

  async sleep(options: RuntimeSleepOptions = {}): Promise<RuntimeSleepResult> {
    const dateKey = options.dateKey ?? formatDateKey();
    const digest = await this.memoryConsolidator.consolidateDay(dateKey);
    return { dateKey, digest };
  }

  async getStatus(): Promise<RuntimeStatus> {
    return {
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      dataDir: this.dataDir,
      projectRoot: this.projectRoot,
      runtimeMode: this.runtimeMode,
      sessionsLoaded: this.manager.size,
      llmEnabled: true,
    };
  }

  listTasks(query: TaskQuery = {}) {
    return this.taskStore.listTasks(query.status ? { status: query.status } : undefined);
  }

  async getCurrentTask(scope: RuntimeScope) {
    if (!scope.userId || !scope.channel || !scope.conversationId) return null;
    const pointer = await this.taskStore.getCurrentPointer(
      scope.userId,
      scope.channel,
      scope.conversationId,
    );
    return pointer ? this.taskStore.getTask(pointer.taskId) : null;
  }

  listWorkingContexts(query: WorkingContextQuery = {}) {
    return this.sessionStore.listWorkingContextSummaries(query, this.taskStore);
  }

  getWorkingContext(contextId: string) {
    return this.sessionStore.getWorkingContextDetail(contextId, this.taskStore);
  }

  listMemoryAtoms(query: MemoryQuery = {}) {
    return this.memoryAtomStore.list(query);
  }

  listMemoryCandidates(query: MemoryCandidateQuery = {}) {
    return this.memoryCandidateStore.list(query);
  }
}
