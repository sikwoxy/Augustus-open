import * as path from "node:path";
import { FileSystemTaskStore } from "../task/store";
import type {
  CurrentTaskPointer,
  ImplementationCheckpointRisk,
  TaskSession,
  TaskVerificationState,
  TaskWorkspaceRef,
  WorkspacePermission,
} from "../task/types";
import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";
import { ensureTaskWorkspace } from "../task/workspace";

function requireDependencies(context: ToolRuntimeContext): { ok: true; store: FileSystemTaskStore } | { ok: false; result: string } {
  if (!context.taskStore) {
    return { ok: false, result: JSON.stringify({ success: false, message: "TaskStore 未配置" }) };
  }
  return { ok: true, store: context.taskStore };
}

function requireCurrentContext(context: ToolRuntimeContext) {
  return context.getCurrentContext?.();
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateGrantRoot(context: ToolRuntimeContext, root: string): string | null {
  const mode = context.runtimeMode ?? (process.env.AUGUSTUS_PROFILE === "production" ? "production" : "local-dev");
  if (mode !== "production") return null;
  const workspacesRoot = path.resolve(context.dataDir, "workspaces");
  return isInside(workspacesRoot, path.resolve(root))
    ? null
    : `production workspace root must be inside ${workspacesRoot}`;
}

async function getCurrentTask(context: ToolRuntimeContext, store: FileSystemTaskStore): Promise<TaskSession | null> {
  const ctx = requireCurrentContext(context);
  if (!ctx) return null;
  const pointer = await store.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);
  if (!pointer) return null;
  return store.getTask(pointer.taskId);
}

async function createTask(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "";
  if (!title) return JSON.stringify({ success: false, message: "title is required" });

  const taskId = FileSystemTaskStore.generateTaskId();
  const task: TaskSession = {
    id: taskId,
    title,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ownerUserId: ctx.userId,
    channels: [
      { channel: ctx.channel, conversationId: ctx.conversationId, joinedAt: Date.now() },
    ],
    agentHints: [],
    goal: typeof args.goal === "string" ? args.goal : undefined,
    titleGeneratedAt: Date.now(),
  };

  await ensureTaskWorkspace(context.dataDir, task, ctx.userId);
  await deps.store.createTask(task);

  const pointer: CurrentTaskPointer = {
    userId: ctx.userId,
    channel: ctx.channel,
    conversationId: ctx.conversationId,
    taskId,
    updatedAt: Date.now(),
  };
  await deps.store.setCurrentPointer(pointer);

  return JSON.stringify({
    success: true,
    taskId,
    title: task.title,
    status: "active",
    workspaceRefs: task.workspaceRefs,
  });
}

async function pauseCurrentTask(context: ToolRuntimeContext): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const pointer = await deps.store.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);
  if (!pointer) return JSON.stringify({ success: false, message: "当前没有活跃的任务" });

  const task = await deps.store.getTask(pointer.taskId);
  if (!task) return JSON.stringify({ success: false, message: "任务不存在" });
  if (task.status !== "active") {
    return JSON.stringify({ success: false, message: `任务状态为 ${task.status}，无法暂停` });
  }

  const updatedTask = await deps.store.updateStatus(pointer.taskId, "paused");
  await deps.store.clearCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);

  return JSON.stringify({
    success: true,
    taskId: task.id,
    title: task.title,
    status: "paused",
    verificationCheckpoint: buildVerificationCheckpoint(updatedTask ?? task),
  });
}

async function completeCurrentTask(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const pointer = await deps.store.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);
  if (!pointer) return JSON.stringify({ success: false, message: "当前没有活跃的任务" });

  const task = await deps.store.getTask(pointer.taskId);
  if (!task) return JSON.stringify({ success: false, message: "任务不存在" });
  if (task.status === "done" || task.status === "archived") {
    return JSON.stringify({ success: false, message: `任务「${task.title}」已经结束` });
  }

  const updatedTask = await deps.store.updateStatus(pointer.taskId, "done");
  await deps.store.clearCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);

  const summary = typeof args.summary === "string" ? args.summary : undefined;
  if (context.onTaskCompleted) {
    Promise.resolve(context.onTaskCompleted(updatedTask ?? task, summary)).catch(() => {});
  }

  return JSON.stringify({
    success: true,
    taskId: task.id,
    title: task.title,
    status: "done",
    verificationCheckpoint: buildVerificationCheckpoint(updatedTask ?? task),
  });
}

async function listTasks(context: ToolRuntimeContext): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const tasks = await deps.store.listTasks();
  if (tasks.length === 0) {
    return JSON.stringify({ tasks: [], message: "暂无任务" });
  }

  const statusLabel: Record<string, string> = {
    active: "活跃",
    paused: "已暂停",
    done: "已完成",
    archived: "已归档",
  };

  const list = tasks.map((task) => ({
    id: task.id.slice(-4),
    title: task.title,
    status: statusLabel[task.status] ?? task.status,
    goal: task.goal?.slice(0, 60),
    verification: summarizeVerificationState(task.verificationState),
    updatedAt: new Date(task.updatedAt).toLocaleString("zh-CN"),
  }));

  return JSON.stringify({ tasks: list });
}

async function showCurrentTask(context: ToolRuntimeContext): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const pointer = await deps.store.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);
  if (!pointer) return JSON.stringify({ success: false, message: "当前没有任务" });

  const task = await deps.store.getTask(pointer.taskId);
  if (!task) return JSON.stringify({ success: false, message: "当前任务不存在" });

  return JSON.stringify({
    id: task.id.slice(-4),
    title: task.title,
    status: task.status === "active" ? "活跃" : task.status,
    goal: task.goal,
    summary: task.summary,
    workspaceRefs: task.workspaceRefs,
    projectRefs: task.projectRefs,
    verificationState: task.verificationState,
    verificationCheckpoint: buildVerificationCheckpoint(task),
    createdAt: new Date(task.createdAt).toLocaleString("zh-CN"),
  });
}

async function resumeTask(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const taskId = typeof args.task_id === "string" ? args.task_id : "";
  const allTasks = await deps.store.listTasks();
  const task = allTasks.find(
    (t) => t.id.endsWith(taskId) && (t.status === "paused" || t.status === "active"),
  );
  if (!task) return JSON.stringify({ success: false, message: `未找到任务 ${taskId}` });

  if (task.status === "paused") {
    await deps.store.updateStatus(task.id, "active");
  }

  const pointer: CurrentTaskPointer = {
    userId: ctx.userId,
    channel: ctx.channel,
    conversationId: ctx.conversationId,
    taskId: task.id,
    updatedAt: Date.now(),
  };
  await deps.store.setCurrentPointer(pointer);

  return JSON.stringify({ success: true, taskId: task.id, title: task.title, status: "active" });
}

async function confirmWorkspaceGrant(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;
  if (!context.workspaceGrantStore) {
    return JSON.stringify({ success: false, message: "WorkspaceGrantStore 未配置" });
  }

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const task = await getCurrentTask(context, deps.store);
  if (!task || task.status !== "active") {
    return JSON.stringify({ success: false, message: "当前没有活跃任务，无法创建 Workspace Grant" });
  }

  const rootInput = typeof args.root === "string" && args.root.trim() ? args.root.trim() : "";
  if (!rootInput) return JSON.stringify({ success: false, message: "root is required" });

  const root = path.resolve(context.projectRoot, rootInput);
  const rootError = validateGrantRoot(context, root);
  if (rootError) return JSON.stringify({ success: false, message: rootError });

  const permissions = normalizePermissions(args.permissions);
  if (permissions.length === 0) {
    return JSON.stringify({ success: false, message: "permissions must include at least one of read/write/execute/network" });
  }

  const grant = await context.workspaceGrantStore.saveGrant({
    taskId: task.id,
    root,
    permissions,
    destructive: false,
    approvedAt: Date.now(),
    approvedBy: ctx.userId,
    note: typeof args.note === "string" ? args.note : undefined,
  });

  const existingRefs = task.workspaceRefs ?? [];
  const hasRef = existingRefs.some((ref) => path.resolve(ref.root) === grant.root);
  if (!hasRef) {
    task.workspaceRefs = [
      ...existingRefs,
      {
        root: grant.root,
        label: typeof args.label === "string" ? args.label : undefined,
        kind: normalizeWorkspaceKind(args.kind),
        addedAt: Date.now(),
      },
    ];
  }
  task.projectRefs = Array.from(new Set([...(task.projectRefs ?? []), grant.root]));
  await deps.store.saveTask(task);

  return JSON.stringify({
    success: true,
    taskId: task.id,
    root: grant.root,
    permissions: grant.permissions,
    destructive: grant.destructive,
  });
}

async function createImplementationCheckpoint(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;
  if (!context.implementationCheckpointStore) {
    return JSON.stringify({ success: false, message: "ImplementationCheckpointStore 未配置" });
  }

  const task = await getCurrentTask(context, deps.store);
  if (!task || task.status !== "active") {
    return JSON.stringify({ success: false, message: "当前没有活跃任务，无法创建 Implementation Checkpoint" });
  }

  const workspaceRoot = typeof args.workspace_root === "string" && args.workspace_root.trim()
    ? path.resolve(context.projectRoot, args.workspace_root.trim())
    : "";
  if (!workspaceRoot) return JSON.stringify({ success: false, message: "workspace_root is required" });
  const rootError = validateGrantRoot(context, workspaceRoot);
  if (rootError) return JSON.stringify({ success: false, message: rootError });

  const checkpoint = await context.implementationCheckpointStore.create({
    taskId: task.id,
    workspaceRoot,
    actions: normalizeStringArray(args.actions),
    nonGoals: normalizeStringArray(args.non_goals),
    acceptanceCriteria: normalizeStringArray(args.acceptance_criteria),
    willInstallDependencies: args.will_install_dependencies === true,
    willCreateOrUpdateLockfile: args.will_create_or_update_lockfile === true,
    risk: normalizeCheckpointRisk(args.risk),
    question: typeof args.question === "string" ? args.question : undefined,
  });

  task.checkpointRefs = Array.from(new Set([...(task.checkpointRefs ?? []), checkpoint.id]));
  await deps.store.saveTask(task);

  return JSON.stringify({ success: true, checkpoint });
}

async function showImplementationCheckpoint(context: ToolRuntimeContext): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;
  if (!context.implementationCheckpointStore) {
    return JSON.stringify({ success: false, message: "ImplementationCheckpointStore 未配置" });
  }
  const task = await getCurrentTask(context, deps.store);
  if (!task) return JSON.stringify({ success: false, message: "当前没有任务" });
  const checkpoints = await context.implementationCheckpointStore.listByTask(task.id);
  return JSON.stringify({
    success: true,
    taskId: task.id,
    latestPending: checkpoints.find((checkpoint) => checkpoint.status === "pending") ?? null,
    checkpoints,
  });
}

async function confirmImplementationCheckpoint(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;
  if (!context.implementationCheckpointStore || !context.workspaceGrantStore) {
    return JSON.stringify({ success: false, message: "Checkpoint 或 WorkspaceGrant store 未配置" });
  }

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });
  const task = await getCurrentTask(context, deps.store);
  if (!task || task.status !== "active") {
    return JSON.stringify({ success: false, message: "当前没有活跃任务，无法确认 checkpoint" });
  }

  const checkpointId = typeof args.checkpoint_id === "string" ? args.checkpoint_id : "";
  const checkpoint = checkpointId
    ? await context.implementationCheckpointStore.get(task.id, checkpointId)
    : await context.implementationCheckpointStore.getLatestPending(task.id);
  if (!checkpoint) return JSON.stringify({ success: false, message: "未找到待确认 checkpoint" });

  checkpoint.status = "confirmed";
  checkpoint.confirmedAt = Date.now();
  checkpoint.confirmedBy = ctx.userId;
  checkpoint.userResponse = typeof args.user_response === "string" ? args.user_response : undefined;
  await context.implementationCheckpointStore.save(checkpoint);

  const permissions = normalizePermissions(args.permissions);
  const grantPermissions = permissions.length > 0 ? permissions : defaultGrantPermissions(checkpoint);
  const grant = await context.workspaceGrantStore.saveGrant({
    taskId: task.id,
    root: checkpoint.workspaceRoot,
    permissions: grantPermissions,
    destructive: false,
    approvedAt: Date.now(),
    approvedBy: ctx.userId,
    note: checkpoint.userResponse ?? checkpoint.question,
  });

  const existingRefs = task.workspaceRefs ?? [];
  if (!existingRefs.some((ref) => path.resolve(ref.root) === grant.root)) {
    task.workspaceRefs = [
      ...existingRefs,
      {
        root: grant.root,
        label: "checkpoint",
        kind: "other",
        addedAt: Date.now(),
      },
    ];
  }
  task.projectRefs = Array.from(new Set([...(task.projectRefs ?? []), grant.root]));
  await deps.store.saveTask(task);

  return JSON.stringify({ success: true, checkpoint, grant });
}

async function showWorkspaceGrant(context: ToolRuntimeContext): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;
  if (!context.workspaceGrantStore) {
    return JSON.stringify({ success: false, message: "WorkspaceGrantStore 未配置" });
  }

  const task = await getCurrentTask(context, deps.store);
  if (!task) return JSON.stringify({ success: false, message: "当前没有任务" });

  const grant = await context.workspaceGrantStore.getGrant(task.id);
  return JSON.stringify({
    success: true,
    taskId: task.id,
    workspaceRefs: task.workspaceRefs ?? [],
    grant,
  });
}

async function switchTask(context: ToolRuntimeContext, args: Record<string, unknown>): Promise<string> {
  const deps = requireDependencies(context);
  if (!deps.ok) return deps.result;

  const ctx = requireCurrentContext(context);
  if (!ctx) return JSON.stringify({ success: false, message: "当前消息上下文不存在" });

  const taskId = typeof args.task_id === "string" ? args.task_id : "";
  const allTasks = await deps.store.listTasks();
  const task = allTasks.find((t) => t.id.endsWith(taskId) && t.status === "active");
  if (!task) return JSON.stringify({ success: false, message: `未找到活跃任务 ${taskId}` });

  const pointer: CurrentTaskPointer = {
    userId: ctx.userId,
    channel: ctx.channel,
    conversationId: ctx.conversationId,
    taskId: task.id,
    updatedAt: Date.now(),
  };
  await deps.store.setCurrentPointer(pointer);

  return JSON.stringify({ success: true, taskId: task.id, title: task.title, status: "active" });
}

export function createTaskTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "create_task",
      description: "创建一个新任务。当用户明确要求新建任务，或描述了一个与当前任务无关的独立需求时调用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "任务标题，6-20字中文，简洁概括用户意图" },
          goal: { type: "string", description: "任务目标，1-2句话描述用户想达成的结果" },
        },
        required: ["title"],
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => createTask(context, args),
    },
    {
      name: "pause_current_task",
      description: "暂停当前活跃任务。用户说「暂停」「挂起」「先放一下」时调用。",
      parameters: { type: "object", properties: {} },
      risk: "write",
      scopes: ["task"],
      handler: async () => pauseCurrentTask(context),
    },
    {
      name: "complete_current_task",
      description: "完成当前任务。用户表示任务结束、完成、搞定、可以了时调用。",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "任务总结（可选），概括任务做了什么" },
        },
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => completeCurrentTask(context, args),
    },
    {
      name: "list_tasks",
      description: "列出所有任务。用户询问「有哪些任务」「任务列表」「查询任务」时调用。",
      parameters: { type: "object", properties: {} },
      risk: "read",
      scopes: ["task"],
      handler: async () => listTasks(context),
    },
    {
      name: "show_current_task",
      description: "查看当前任务详情。用户问「当前任务是什么」「当前进度」时调用。",
      parameters: { type: "object", properties: {} },
      risk: "read",
      scopes: ["task"],
      handler: async () => showCurrentTask(context),
    },
    {
      name: "resume_task",
      description: "恢复一个已暂停的任务。用户说「继续...」且当前无活跃任务时调用。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "要恢复的任务 ID（短号，如 e34f）" },
        },
        required: ["task_id"],
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => resumeTask(context, args),
    },
    {
      name: "switch_task",
      description: "切换到另一个活跃任务。用户想换到别的任务时调用。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "要切换到的任务 ID（短号，如 e34f）" },
        },
        required: ["task_id"],
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => switchTask(context, args),
    },
    {
      name: "confirm_workspace_grant",
      description:
        "在用户已经明确确认实施边界后，为当前任务创建 Workspace Grant。用于授权 coder 在指定 workspace root 内读写或执行。不得在用户未确认时调用。",
      parameters: {
        type: "object",
        properties: {
          root: { type: "string", description: "用户确认的工作区根目录。可以是绝对路径，也可以是相对当前 projectRoot 的路径。" },
          permissions: {
            type: "array",
            items: { type: "string", enum: ["read", "write", "execute", "network"] },
            description: "授权权限。写项目文件需要 write，运行 shell/验证需要 execute。",
          },
          label: { type: "string", description: "工作区标签，可选" },
          kind: { type: "string", enum: ["runtime", "frontend", "external_clone", "artifact", "other"], description: "工作区类型，可选" },
          note: { type: "string", description: "用户确认的边界摘要，可选" },
        },
        required: ["root", "permissions"],
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => confirmWorkspaceGrant(context, args),
    },
    {
      name: "show_workspace_grant",
      description: "查看当前任务的 Workspace Grant 和 workspace refs。",
      parameters: { type: "object", properties: {} },
      risk: "read",
      scopes: ["task"],
      handler: async () => showWorkspaceGrant(context),
    },
    {
      name: "create_implementation_checkpoint",
      description:
        "在开始有实际副作用的实施前创建待用户确认的 Implementation Checkpoint。用于说明 workspace、行动、非目标、验收标准、依赖/lockfile 风险。",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string", description: "准备实施的 workspace root" },
          actions: { type: "array", items: { type: "string" }, description: "准备做什么" },
          non_goals: { type: "array", items: { type: "string" }, description: "明确暂不做什么" },
          acceptance_criteria: { type: "array", items: { type: "string" }, description: "验收标准" },
          will_install_dependencies: { type: "boolean", description: "是否会安装依赖" },
          will_create_or_update_lockfile: { type: "boolean", description: "是否会创建或更新 lockfile" },
          risk: { type: "string", enum: ["low", "medium", "high"], description: "风险等级" },
          question: { type: "string", description: "询问用户确认的简短问题" },
        },
        required: ["workspace_root", "actions", "acceptance_criteria", "risk"],
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => createImplementationCheckpoint(context, args),
    },
    {
      name: "show_implementation_checkpoint",
      description: "查看当前任务的 Implementation Checkpoint，尤其是最新 pending checkpoint。",
      parameters: { type: "object", properties: {} },
      risk: "read",
      scopes: ["task"],
      handler: async () => showImplementationCheckpoint(context),
    },
    {
      name: "confirm_implementation_checkpoint",
      description:
        "用户明确确认 pending checkpoint 后调用。确认后会生成 Workspace Grant。不得在用户未确认时调用。",
      parameters: {
        type: "object",
        properties: {
          checkpoint_id: { type: "string", description: "checkpoint id；不传则确认最新 pending checkpoint" },
          user_response: { type: "string", description: "用户确认或补充的原文摘要" },
          permissions: {
            type: "array",
            items: { type: "string", enum: ["read", "write", "execute", "network"] },
            description: "可选授权权限；不传则根据 checkpoint 自动推断",
          },
        },
      },
      risk: "write",
      scopes: ["task"],
      handler: async (_name, args) => confirmImplementationCheckpoint(context, args),
    },
  ];
}

function normalizePermissions(input: unknown): WorkspacePermission[] {
  const allowed = new Set<WorkspacePermission>(["read", "write", "execute", "network"]);
  const values = Array.isArray(input) ? input : [];
  return Array.from(new Set(values.filter((value): value is WorkspacePermission => allowed.has(value))));
}

function normalizeWorkspaceKind(input: unknown): TaskWorkspaceRef["kind"] {
  if (
    input === "task_workspace" ||
    input === "runtime" ||
    input === "frontend" ||
    input === "external_clone" ||
    input === "artifact" ||
    input === "other"
  ) {
    return input;
  }
  return undefined;
}

function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeCheckpointRisk(input: unknown): ImplementationCheckpointRisk {
  return input === "low" || input === "medium" || input === "high" ? input : "medium";
}

function defaultGrantPermissions(checkpoint: {
  actions: string[];
  willInstallDependencies: boolean;
}): WorkspacePermission[] {
  const text = checkpoint.actions.join("\n").toLowerCase();
  const permissions = new Set<WorkspacePermission>(["read"]);
  // 匹配英文和中文的写入/执行关键词
  const writeExecutePattern =
    /\b(write|edit|modify|create|patch|install|npm|pnpm|yarn|build|test|lint|typecheck|run|生成|创建|写入|修改|编辑|安装|构建|测试|执行|运行|部署|打包|编译)\b/i;
  if (checkpoint.willInstallDependencies || writeExecutePattern.test(text)) {
    permissions.add("write");
    permissions.add("execute");
  }
  return Array.from(permissions);
}

function buildVerificationCheckpoint(task: TaskSession): Record<string, unknown> {
  const records = task.verificationState?.records ?? [];
  const passed = records.filter((record) => record.status === "passed");
  const failed = records.filter((record) => record.status === "failed");
  const blocked = records.filter((record) => record.status === "blocked");

  return {
    updatedAt: task.verificationState?.updatedAt,
    verified: passed.map((record) => record.summary ?? `${record.label}: passed`),
    failed: failed.map((record) => record.summary ?? `${record.label}: failed`),
    blocked: blocked.map((record) => record.summary ?? `${record.label}: blocked`),
    unverified: inferUnverified(records.map((record) => record.key)),
  };
}

function summarizeVerificationState(state?: TaskVerificationState): string {
  if (!state || state.records.length === 0) return "未验证";
  const passed = state.records.filter((record) => record.status === "passed").length;
  const failed = state.records.filter((record) => record.status === "failed").length;
  const blocked = state.records.filter((record) => record.status === "blocked").length;
  return `passed=${passed}, failed=${failed}, blocked=${blocked}`;
}

function inferUnverified(doneKeys: string[]): string[] {
  const done = new Set(doneKeys);
  const expected: Array<[string, string]> = [
    ["typecheck_passed", "typecheck 未验证"],
    ["tests_passed", "tests 未验证"],
    ["lint_passed", "lint 未验证"],
    ["dev_server_started", "dev server 未验证"],
    ["localhost_reachable", "localhost 可访问性未验证"],
    ["browser_verified", "browser 未验证"],
    ["interaction_verified", "关键交互未验证"],
  ];
  return expected
    .filter(([key]) => !done.has(key))
    .map(([, label]) => label);
}
