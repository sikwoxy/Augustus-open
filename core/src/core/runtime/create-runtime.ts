import { AnthropicAdapter } from "../../llm/adapters/anthropic";
import { OpenAIAdapter } from "../../llm/adapters/openai";
import { createConfig } from "../../llm/config";
import { resolveProviderFromEnv } from "../../llm/provider-selection";
import { LoopManager } from "../loop";
import { FileSystemSessionStore } from "../loop/session-store";
import { FileSystemAgentRunStore } from "../agents/run-store";
import { AgentRunner } from "../agents/runner";
import {
  FileSystemTaskStore,
  FileSystemImplementationCheckpointStore,
  FileSystemWorkspaceGrantStore,
  TaskMetadataService,
  TaskOrchestrator,
} from "../task";
import {
  FileSystemMemoryAtomStore,
  FileSystemMemoryCandidateStore,
  FileSystemMemoryDigestStore,
  FileSystemMemoryEpisodeStore,
  FileSystemMemoryEventStore,
  MemoryConsolidator,
  MemoryLoader,
} from "../memory";
import { registerDefaultTools, ToolRegistry } from "../tools";
import { SkillRegistry, loadSkills } from "../skills";
import { AugustusRuntimeImpl } from "./runtime";
import type { AugustusRuntimeMode } from "../tools/tool-context";

export interface CreateAugustusRuntimeOptions {
  dataDir?: string;
  projectRoot?: string;
  runtimeMode?: AugustusRuntimeMode;
  webSearchMaxUses?: number;
}

export function createAugustusRuntime(
  options: CreateAugustusRuntimeOptions = {},
): AugustusRuntimeImpl {
  const dataDir = options.dataDir ?? process.env.AUGUSTUS_DATA_DIR ?? ".augustus";
  const projectRoot = options.projectRoot ?? process.cwd();
  const runtimeMode: AugustusRuntimeMode =
    options.runtimeMode ?? (process.env.AUGUSTUS_PROFILE === "production" ? "production" : "local-dev");

  const sessionStore = new FileSystemSessionStore(dataDir);
  sessionStore.init();

  const taskStore = new FileSystemTaskStore(dataDir);
  taskStore.init();

  const workspaceGrantStore = new FileSystemWorkspaceGrantStore(dataDir);
  workspaceGrantStore.init();

  const implementationCheckpointStore = new FileSystemImplementationCheckpointStore(dataDir);
  implementationCheckpointStore.init();

  const runStore = new FileSystemAgentRunStore(dataDir);
  runStore.init();

  const memoryEventStore = new FileSystemMemoryEventStore(dataDir);
  memoryEventStore.init();

  const memoryDigestStore = new FileSystemMemoryDigestStore(dataDir);
  memoryDigestStore.init();

  const memoryEpisodeStore = new FileSystemMemoryEpisodeStore(dataDir);
  memoryEpisodeStore.init();

  const memoryCandidateStore = new FileSystemMemoryCandidateStore(dataDir);
  memoryCandidateStore.init();

  const memoryAtomStore = new FileSystemMemoryAtomStore(dataDir);
  memoryAtomStore.init();

  const memoryConsolidator = new MemoryConsolidator(
    memoryEventStore,
    memoryDigestStore,
    memoryEpisodeStore,
    memoryCandidateStore,
    memoryAtomStore,
  );

  const config = createConfig();
  const provider = resolveProviderFromEnv("AUGUSTUS_MAIN_PROVIDER");
  const adapter = provider === "openai"
    ? new OpenAIAdapter(config)
    : new AnthropicAdapter(config, {
        webSearchMaxUses: options.webSearchMaxUses ?? 3,
      });
  const webSearchEnabled = adapter.supportsServerTool("web_search");
  const manager = new LoopManager(adapter, {}, sessionStore);
  manager.registerProfile({
    type: "assistant",
    name: "Assistant",
    allowedTools: [
      ...(webSearchEnabled ? ["web_search"] as const : []),
      "create_task",
      "create_memory_candidate",
      "pause_current_task",
      "complete_current_task",
      "list_tasks",
      "show_current_task",
      "resume_task",
      "switch_task",
      "confirm_workspace_grant",
      "show_workspace_grant",
      "create_implementation_checkpoint",
      "show_implementation_checkpoint",
      "confirm_implementation_checkpoint",
      "read_file",
      "write_file",
      "send_file",
      "delegate_to_agent",
    ],
    systemPrompt: "You are Augustus, a persistent assistant runtime.",
  });

  const metadataService = new TaskMetadataService(adapter);
  const memoryLoader = new MemoryLoader(memoryDigestStore, memoryAtomStore);
  const toolRegistry = new ToolRegistry();
  const skillRegistry = new SkillRegistry();

  const { skills, diagnostics: skillDiagnostics } = loadSkills(projectRoot);
  for (const skill of skills) {
    skillRegistry.register(skill);
  }
  for (const diag of skillDiagnostics) {
    const prefix = diag.level === "error" ? "ERROR" : "WARNING";
    console.warn(`[skills] ${prefix}: ${diag.message} (${diag.skillDir})`);
  }
  let agentRunner: AgentRunner | null = null;
  let orchestrator: TaskOrchestrator;

  registerDefaultTools(toolRegistry, {
    dataDir,
    projectRoot,
    runtimeMode,
    taskStore,
    workspaceGrantStore,
    implementationCheckpointStore,
    getCurrentContext: () => orchestrator.currentContext,
    addReplyFile: (file) => orchestrator.addReplyFile(file),
    getAgentRunner: () => agentRunner,
    onTaskCompleted: (task, summary) => orchestrator.handleTaskCompleted(task, summary),
  });

  agentRunner = new AgentRunner({
    dataDir,
    projectRoot,
    runtimeMode,
    runStore,
    taskStore,
    workspaceGrantStore,
    toolRegistry,
    memoryEventStore,
  });

  orchestrator = new TaskOrchestrator(manager, taskStore, {
    dataDir,
    projectRoot,
    runtimeMode,
    metadataService,
    agentRunner,
    agentRunStore: runStore,
    toolRegistry,
    workspaceGrantStore,
    implementationCheckpointStore,
    memoryEventStore,
    memoryCandidateStore,
    memoryLoader,
    skillRegistry,
    webSearchEnabled,
  });

  return new AugustusRuntimeImpl({
    dataDir,
    projectRoot,
    runtimeMode,
    manager,
    sessionStore,
    taskStore,
    orchestrator,
    memoryConsolidator,
    memoryAtomStore,
    memoryCandidateStore,
  });
}
