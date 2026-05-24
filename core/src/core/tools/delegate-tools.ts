import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";
import type { AgentRunPhase } from "../agents/types";

const AGENT_RUN_PHASES = new Set<AgentRunPhase>([
  "default",
  "command_only",
  "inspect_only",
  "edit_files",
  "implement_feature",
  "verify",
]);

export function createDelegateTools(context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "delegate_to_agent",
      description:
        "将当前任务中的一部分工作委托给指定 AgentProfile 执行。当任务需要代码分析、项目源码修改、受限 shell 命令、git 只读检查、typecheck/test/lint 验证、资料研究、文档整理等专业能力时使用。调用前必须已有活跃任务；如果没有活跃任务，请先调用 create_task。不要为调用 Agent 创建额外新 Task，AgentRun 属于当前 Task 内部过程。使用 phase 表达执行阶段和先后顺序；mode 仅为兼容旧调用。",
      parameters: {
        type: "object",
        properties: {
          agent_type: { type: "string", description: "要委托的 agent 类型，如 coder、researcher、writer。代码、shell、git、测试和项目文件修改类任务使用 coder。" },
          phase: {
            type: "string",
            enum: ["default", "command_only", "inspect_only", "edit_files", "implement_feature", "verify"],
            description: "执行阶段，用于表达这次委托在任务中的先后顺序和工具预算。只执行命令用 command_only；只读检查用 inspect_only；改少量文件用 edit_files；完整实现用 implement_feature；验证用 verify。优先使用 phase。",
          },
          mode: {
            type: "string",
            enum: ["default", "command_only", "inspect_only", "edit_files", "implement_feature", "verify"],
            description: "Legacy alias for phase. Prefer phase.",
          },
          instruction: { type: "string", description: "给 subagent 的明确执行指令" },
          context: { type: "string", description: "必要上下文摘要，不要传入完整无关历史" },
          expected_output: { type: "string", description: "期望 subagent 返回的结果格式或内容" },
        },
        required: ["agent_type", "instruction"],
      },
      risk: "execute",
      scopes: ["agent"],
      handler: async (_name, args) => {
        const ctx = context.getCurrentContext?.();
        if (!ctx) {
          return JSON.stringify({ success: false, message: "当前消息上下文不存在" });
        }
        if (!context.taskStore) {
          return JSON.stringify({ success: false, message: "TaskStore 未配置，无法委托子 Agent" });
        }

        const pointer = await context.taskStore.getCurrentPointer(ctx.userId, ctx.channel, ctx.conversationId);
        if (!pointer) {
          return JSON.stringify({ success: false, message: "当前没有活跃的任务，请先创建或继续一个任务" });
        }

        const task = await context.taskStore.getTask(pointer.taskId);
        if (!task || task.status !== "active") {
          return JSON.stringify({ success: false, message: "当前任务不是活跃状态，请先创建或继续一个任务" });
        }

        const agentRunner = context.getAgentRunner?.();
        if (!agentRunner) {
          return JSON.stringify({ success: false, message: "AgentRunner 未配置，无法委托子 Agent" });
        }

        const agentType = typeof args.agent_type === "string" ? args.agent_type : "";
        const instruction = typeof args.instruction === "string" ? args.instruction : "";
        const phase = normalizePhase(args.phase) ?? normalizePhase(args.mode);
        if (!agentType || !instruction) {
          return JSON.stringify({ success: false, message: "agent_type 和 instruction 为必填参数" });
        }

        const run = await agentRunner.run({
          taskId: task.id,
          agentType,
          phase,
          mode: phase,
          instruction,
          context: typeof args.context === "string" ? args.context : undefined,
          expectedOutput: typeof args.expected_output === "string" ? args.expected_output : undefined,
        });

        return JSON.stringify({
          success: run.status === "done",
          outcome: run.outcome ?? (run.status === "done" ? "done" : "failed"),
          runId: run.id,
          agentType: run.agentType,
          phase: run.phase ?? run.mode,
          mode: run.mode,
          summary: run.result?.summary,
          output: run.result?.output,
          usedTools: run.usedTools,
          continuationPack: run.continuationPack,
          error: run.error,
        });
      },
    },
  ];
}

function normalizePhase(value: unknown): AgentRunPhase | undefined {
  if (typeof value !== "string") return undefined;
  return AGENT_RUN_PHASES.has(value as AgentRunPhase) ? value as AgentRunPhase : undefined;
}
