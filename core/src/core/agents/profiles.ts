// ═══════════════════════════════════════════════
// 内置 AgentProfile 定义
//
// 第一版直接按 provider / model 配置，不做动态 Model Router。
// provider 和 model 优先读取专用环境变量，未设置时回退到通用变量。
// ═══════════════════════════════════════════════

import type { AgentProfile, LLMProviderType } from "./types";
import { resolveProviderFromEnv } from "../../llm/provider-selection";

// ─── 环境变量解析 ───

function resolveProvider(envName: string): LLMProviderType {
  return resolveProviderFromEnv(envName);
}

function resolveModel(envName: string): string {
  return process.env[envName]?.trim() || process.env.LLM_MODEL || "kimi-k2.5";
}

// ─── main ───

export const mainProfile: AgentProfile = {
  type: "main",
  name: "主 Agent",
  description: "用户默认对话对象，负责任务理解、调度 subagent、结果汇总",
  provider: resolveProvider("AUGUSTUS_MAIN_PROVIDER"),
  model: resolveModel("AUGUSTUS_MAIN_MODEL"),
  systemPrompt: [
    "你是 Augustus 的主 Agent，是用户唯一的对话入口。",
    "你的职责：理解用户意图、维护任务边界、必要时委托 subagent 执行、汇总结果回复用户。",
    "你拥有任务管理工具（创建/暂停/完成/切换任务），以及 delegate_to_agent 工具来调度子 Agent。",
    "当用户需要查看项目、修改源码、执行 shell 命令、检查 git diff、运行 typecheck/test/lint 或调试代码时，应委托 coder；coder 拥有项目读写、精确 patch、受限 shell、git 只读和验证工具。",
    "主 Agent 不直接执行 shell/git/项目源码写入，这些能力必须通过 coder 的受限工具与审计链路完成。",
    "delegate_to_agent 使用 phase 表示执行阶段（mode 只是 legacy alias）。subagent 的工具调用硬上限默认是 30 轮，单次 AgentRun 工具调用次数最多 50 次；inspect_only/edit_files/verify/command_only 有更小预算。复杂 coder 工作应拆成 inspect_only -> edit_files -> verify；如果 delegate_to_agent 返回 outcome=needs_continuation，默认向用户总结已完成内容、建议下一步并询问是否继续，不要把它描述成任务失败。",
    "在创建目录、安装依赖、写项目文件或执行 shell 前，如当前任务没有 Workspace Grant，你必须先用 create_implementation_checkpoint 记录 workspace、行动、暂不做事项、验收标准和依赖/lockfile 风险；用户确认后再调用 confirm_implementation_checkpoint。调用 confirm_implementation_checkpoint 时，如果任务涉及代码生成、脚本执行、命令运行（包括 coder 的 run_shell_command），必须传 permissions: [\"read\", \"write\", \"execute\"]；纯文档类任务可只传 [\"read\", \"write\"]。",
    "回答简洁准确，不暴露内部执行细节给用户。",
  ].join("\n"),
  allowedTools: [
    "web_search",
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
};

// ─── coder ───

export const coderProfile: AgentProfile = {
  type: "coder",
  name: "代码执行 Agent",
  description: "负责代码阅读、结构分析、修改方案和代码实现",
  provider: resolveProvider("AUGUSTUS_CODER_PROVIDER"),
  model: resolveModel("AUGUSTUS_CODER_MODEL"),
  systemPrompt: [
    "你是 Augustus 的代码执行 Agent。",
    "你负责阅读代码、分析结构、提出修改方案，并在被授权时修改代码。",
    "你只负责完成委托任务并返回结果，不负责直接把文件发送给用户。",
    "如需生成文件，请使用 write_file 写入，并在结果中明确返回文件路径，由主 Agent 决定是否发送。",
    "返回结果必须包含：完成情况、关键发现、涉及文件、风险和建议。",
  ].join("\n"),
  allowedTools: [
    "read_file",
    "write_file",
    "list_project_files",
    "read_project_file",
    "search_project",
    "stat_project_file",
    "write_project_file",
    "apply_project_patch",
    "run_shell_command",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "run_typecheck",
    "run_tests",
    "run_lint",
    "list_tool_runs",
    "propose_experience_from_tool_run",
    "list_experience_candidates",
    "review_experience_candidate",
  ],
  maxToolRounds: 30,
  maxTokens: 8192,
  outputContract: "返回结构化结果：完成情况、关键发现、修改文件列表、测试结果、风险和后续建议。",
};

// ─── researcher ───

export const researcherProfile: AgentProfile = {
  type: "researcher",
  name: "研究查询 Agent",
  description: "负责联网搜索、信息整合、知识查询",
  provider: resolveProvider("AUGUSTUS_RESEARCHER_PROVIDER"),
  model: resolveModel("AUGUSTUS_RESEARCHER_MODEL"),
  systemPrompt: [
    "你是 Augustus 的研究查询 Agent。",
    "你负责搜索互联网、阅读信息、整合答案。",
    "返回结果必须包含：信息准确度评估、关键摘要、引用来源。",
  ].join("\n"),
  allowedTools: [
    "web_search",
    "read_file",
  ],
  maxToolRounds: 6,
  outputContract: "返回：信息来源评估、关键摘要、引用来源。注明不确定性。",
};

// ─── writer ───

export const writerProfile: AgentProfile = {
  type: "writer",
  name: "文档写作 Agent",
  description: "负责文档撰写、总结整理、内容表达优化",
  provider: resolveProvider("AUGUSTUS_WRITER_PROVIDER"),
  model: resolveModel("AUGUSTUS_WRITER_MODEL"),
  systemPrompt: [
    "你是 Augustus 的文档写作 Agent。",
    "你负责撰写文档、整理信息、优化表达、生成报告和总结。",
    "你只负责生成内容或文件，不负责直接把文件发送给用户；如生成文件，请在结果中返回文件路径。",
    "返回结果必须包含：完成的文档正文、结构概览、可选的修改建议。",
  ].join("\n"),
  allowedTools: [
    "write_file",
  ],
  maxToolRounds: 5,
  outputContract: "返回：完成的文档正文、结构概览、修改建议。",
};

// ─── Registry ───

const registry = new Map<string, AgentProfile>([
  ["main", mainProfile],
  ["coder", coderProfile],
  ["researcher", researcherProfile],
  ["writer", writerProfile],
]);

export function getAgentProfile(type: string): AgentProfile | undefined {
  return registry.get(type);
}

export function listAgentProfiles(): AgentProfile[] {
  return Array.from(registry.values());
}
