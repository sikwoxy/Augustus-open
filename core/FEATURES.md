# Augustus 原型 — 功能列表与进度

> 更新时间：2026-05-14

## 一、LLM 适配器

| 功能 | 状态 | 说明 |
|---|---|---|
| LLMAdapter 接口 | 完成 | `chat(options)` 统一接口，解耦具体 API |
| AnthropicAdapter | 完成 | 对接 Anthropic Messages API，含消息格式双向转换 |
| OpenAIAdapter | 完成 | 对接 OpenAI Chat Completions，JSON object 响应格式 |
| 服务端 web_search | 完成 | 通过 Anthropic server tool `web_search_20250305` 实现，可配置 max_uses |
| DeepSeek reasoning_content 传递 | 完成 | 保留 reasoning_content 原样传回，支持 thinking mode |
| 环境变量配置 | 完成 | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` |
| 流式输出 | 部分 | `LLMClient.streamChat()` 已实现，Loop 层未接入 |

文件：`src/llm/adapter.ts` `src/llm/adapters/anthropic.ts` `src/llm/adapters/openai.ts` `src/llm/client.ts` `src/llm/config.ts` `src/llm/types.ts`

---

## 二、对话引擎（Loop）

| 功能 | 状态 | 说明 |
|---|---|---|
| 多轮对话 | 完成 | 消息历史自动累积 |
| Tool Call 循环 | 完成 | 自动多轮执行，上限 10 轮防死循环 |
| 工具注册 | 完成 | `registerTool(name, description, params, handler)` |
| Token 用量统计 | 完成 | 累加所有轮次 |
| 系统提示词 | 完成 | 支持动态替换 `setSystemPrompt()` |
| 会话重置 | 完成 | `reset()` 保留 system prompt |
| 消息恢复 | 完成 | `restoreMessages()` 从持久化历史重建 |
| Tool 参数解析防护 | 完成 | 工具参数 JSON 解析失败时返回结构化错误，不再以 `{}` 静默执行 |
| 非 final 结束识别 | 完成 | `max_tool_rounds` / `tool_error` 等结束原因会传递给上层，用于标记 subagent 失败；`max_tool_rounds` 附带结构化诊断 |

文件：`src/core/loop/loop.ts` `src/core/loop/types.ts`

---

## 三、会话管理（LoopManager）

| 功能 | 状态 | 说明 |
|---|---|---|
| 多会话并存 | 完成 | 不同 sessionId 完全隔离 |
| Agent Profile | 完成 | 按 agentType 绑定 systemPrompt + 工具白名单 |
| 按 agentType 注册工具模板 | 完成 | 新会话自动继承 |
| 会话持久化 | 完成 | `FileSystemSessionStore` 自动保存/恢复对话 |
| 消息按 taskId 标记 | 完成 | 持久化层 `PersistedMessage.taskId`，支持按任务检索消息 |
| 跨会话 preload | 完成 | 启动时从磁盘恢复所有已知 session |
| turn 后任务绑定修正 | 完成 | create_task 后同一轮消息会回填最终 taskId，避免首轮委托记录为 null |

文件：`src/core/loop/manager.ts` `src/core/loop/session-store.ts`

---

## 四、任务系统

| 功能 | 状态 | 说明 |
|---|---|---|
| 创建任务 | 完成 | LLM 通过 `create_task` 工具调用 |
| 暂停/恢复/切换任务 | 完成 | 均有对应 tool |
| 完成任务（含摘要） | 完成 | `complete_current_task`，触发元数据后台生成 |
| 查看任务列表/详情 | 完成 | `list_tasks` / `show_current_task` |
| 文件系统持久化 | 完成 | JSON 文件存 `.augustus/tasks/{active,paused,done,archived}/` |
| 当前任务指针 | 完成 | 按 userId+channel+conversationId 维度 |
| Workspace refs | 完成 | TaskSession 记录 `workspaceRefs` 和 `projectRefs`，用于绑定任务工作区 |
| Workspace Grant | 完成 | 用户确认边界后通过 `confirm_workspace_grant` 授权，落盘到 `.augustus/workspace-grants/{taskId}.json` |
| Implementation Checkpoint | 完成 | `create_implementation_checkpoint` 记录待确认边界，`confirm_implementation_checkpoint` 确认后生成 Workspace Grant |
| Verification Contract v0 | 完成 | TaskSession 记录 `verificationState`；验证工具写回 passed/failed/blocked；暂停/完成时返回验收 checkpoint |
| 任务元数据后台生成 | 完成 | `TaskMetadataService` — 首轮 title+goal、中间总结、完成时 summary+outcome+todos |
| 暂停目录初始化 | 完成 | paused 任务文件保存在 `tasks/paused/` 目录 |
| 动态 system prompt | 完成 | 每轮 turn 注入当前任务上下文和指引 |
| Subagent 委托 | 完成 | `delegate_to_agent` 可按任务上下文委托 coder / researcher / writer |
| Subagent 执行模式 | 完成 | `delegate_to_agent.mode` 支持 `command_only` / `inspect_only` / `edit_files` / `implement_feature` / `verify`，并按模式裁剪工具 |
| AgentRun 持久化 | 完成 | subagent 每次执行记录到 `.augustus/agent-runs/{taskId}/`，包含工具事件和结果 |
| Task-scoped Agent Thread | 完成 | 每个 task 内为 coder / researcher / writer 维护连续上下文摘要，落盘到 `.augustus/agent-threads/` |

文件：`src/core/task/orchestrator.ts` `src/core/task/store.ts` `src/core/task/types.ts` `src/core/task/metadata.ts` `src/core/task/workspace-grant-store.ts` `src/core/task/implementation-checkpoint-store.ts`

---

## 五、飞书 Bot — 消息接收

| 功能 | 状态 | 说明 |
|---|---|---|
| 长连接接收事件 | 完成 | `@larksuiteoapi/node-sdk` WSClient + EventDispatcher |
| 文本消息路由 | 完成 | 支持 `/cmd` / `/cmd:topic` 前缀切 agent（由 start-feishu.ts 调用 `parseRoute`），通过 `agentHint` 传入 runtime |
| 串行队列 | 完成 | 同会话串行处理，不同会话并行（SerialQueue 在 start-feishu.ts 管理） |
| 文件消息接收 | 完成 | 识别 file / image / audio / video / media 类型 |
| 文件下载到本地 | 完成 | 存储到 `.augustus/files/` |
| 文件上下文传给 LLM | 完成 | `read_file` tool 可读取文本文件内容 |
| Content-Disposition 中文文件名 | 完成 | RFC 5987 + Latin-1 → UTF-8 自动解码 |

文件：`src/channels/feishu.ts`（飞书 API 封装） `src/start-feishu.ts`（消息解析、排队、runtime 调用）

---

## 六、飞书 Bot — 消息发送

| 功能 | 状态 | 说明 |
|---|---|---|
| 文本回复 | 完成 | 回复到原消息 |
| 上传文件到飞书 | 完成 | 支持 19 种扩展名推断 fileType |
| 上传图片到飞书 | 完成 | message 类型图片 |
| 回复文件/图片 | 完成 | `sendFileReply()` / `sendImageReply()` |
| 文本+附件组合回复 | 完成 | `reply(msgId, text, files?)` |
| LLM 主动发送文件 | 完成 | `write_file` + `send_file` tool，自动填充 `replyFiles` |

文件：`src/channels/feishu.ts`

---

## 七、优雅关闭

| 功能 | 状态 | 说明 |
|---|---|---|
| SIGINT/SIGTERM 信号处理 | 完成 | 不再接受新消息 |
| pending 操作排空 | 完成 | 最多等待 15 秒 |
| 超时强制退出 | 完成 | 20 秒后兜底 |

文件：`src/start-feishu.ts`

---

## 八、调试与日志

| 功能 | 状态 | 说明 |
|---|---|---|
| 结构化日志 | 完成 | 每轮对话输出 sessionId / latency / tokens |
| Debug 模式 | 完成 | `AUGUSTUS_DEBUG_MODE=true` 写 JSON 到 `temp/feishu-debug/` |
| AgentRun 控制台摘要 | 完成 | Debug 模式下输出 subagent 运行状态、结束原因、工具调用数和失败工具数 |
| 工具失败可观测性 | 完成 | 工具参数错误和 handler 失败会进入 toolEvents，便于定位空文件/循环调用问题 |
| Tool audit 持久化 | 完成 | 每次工具调用写入 `.augustus/tool-runs/{date}.jsonl`，可按时间、工具名和 ID 检索 |
| Environment Prior v0 | 完成 | 安装/初始化阶段识别宿主 OS、shell、语言 runtime、包管理器、浏览器、容器和代理摘要，写入 `.augustus/environment/host-prior.json` |
| Tool Experience v0 | 完成 | 可从 tool audit 生成面向 subagent/skill/tool runtime 的工具经验候选，并经用户确认后标记 approved/rejected/superseded |
| Diagnostics 工具 | 完成 | `serializeError()` 结构化错误序列化，支持嵌套 cause、code、details；Loop 和 AgentRunner 均使用结构化诊断输出 |

文件：`src/utils/debug-logger.ts` `src/utils/diagnostics.ts`

---

## 九、示例程序

| 示例 | 入口 | 说明 |
|---|---|---|
| 单次对话 | `npm run basic-chat` | 最简调用 |
| 多轮对话 | `npm run multi-turn` | 手动累积消息 |
| Tool Call | `npm run tool-call` | 单工具执行 |
| 结构化输出 | `npm run structured-output` | JSON 提取 |
| Loop 交互 | `npm run loop-demo` | REPL + 多工具，完整 Loop 实例 |
| 会话隔离 | `npm run session-demo` | 验证多用户隔离 |
| AgentRun 示例 | `npm run agent-run-demo` | 验证 subagent 独立执行和运行记录 |
| 任务委托 E2E | `npm run agent-task-e2e` | 验证主 Agent 创建任务并委托 subagent |
| 自然语言任务委托 | `npm run agent-task-natural-demo` | 验证自然语言触发任务与委托流程 |
| Memory Seed | `npm run memory-seed` | 预填充 memory atoms，模拟长期记忆 |
| Memory Sleep | `npm run memory-sleep` | 执行每日记忆整理，生成 digest/episode |
| Environment Probe | `npm run environment-probe` | 探测宿主环境能力并生成 HostEnvironmentPrior |

---

## 十、LLM 工具清单

| 工具名 | 类别 | 说明 |
|---|---|---|
| `web_search` | 服务端 | Anthropic server tool，联网搜索（可配置 max_uses） |
| `create_task` | 任务管理 | 创建新任务，填写标题和可选目标 |
| `pause_current_task` | 任务管理 | 暂停当前活跃任务 |
| `complete_current_task` | 任务管理 | 完成当前任务，触发元数据后台生成 |
| `list_tasks` | 任务管理 | 列出所有任务 |
| `show_current_task` | 任务管理 | 查看当前任务详情 |
| `resume_task` | 任务管理 | 恢复已暂停任务（通过短 ID） |
| `switch_task` | 任务管理 | 切换到另一活跃任务（通过短 ID） |
| `confirm_workspace_grant` | Workspace Grant | 用户确认实施边界后，为当前任务授权 workspace root 和 read/write/execute/network 权限 |
| `show_workspace_grant` | Workspace Grant | 查看当前任务 workspace refs 和 grant |
| `create_implementation_checkpoint` | Implementation Checkpoint | 创建待用户确认的实施边界，记录 workspace、行动、非目标、验收标准和风险 |
| `show_implementation_checkpoint` | Implementation Checkpoint | 查看当前任务 checkpoint，尤其是 latest pending checkpoint |
| `confirm_implementation_checkpoint` | Implementation Checkpoint | 用户确认后标记 checkpoint，并自动生成 Workspace Grant |
| `delegate_to_agent` | Agent 委托 | 主 Agent 按任务上下文委托 coder / researcher / writer |
| `read_file` | 文件操作 | 读取 `.augustus/files/` 下的文本文件 |
| `write_file` | 文件操作 | 将内容写入文件，返回路径供 send_file 使用 |
| `send_file` | 文件操作 | 将文件发送给用户（通过当前渠道） |
| `create_memory_candidate` | 记忆 | 创建长期记忆候选，不会直接写入 long-term memory；候选在 memory sleep 中整理 |
| `list_project_files` | 项目只读 | coder 可列出项目内文件，跳过 node_modules、.git、dist、temp、`.augustus/files` |
| `read_project_file` | 项目只读 | coder 可读取项目内文本文件，限制路径逃逸、二进制文件和 200KB 大文件 |
| `search_project` | 项目只读 | coder 可在项目文本文件中搜索，最多返回 50 条结果 |
| `stat_project_file` | 项目只读 | coder 可查看项目文件或目录元数据 |
| `write_project_file` | 项目写入 | coder 可写入项目内 UTF-8 文本文件，拒绝路径逃逸和常见二进制扩展名 |
| `apply_project_patch` | 项目写入 | coder 可用精确 old_text/new_text 替换项目文件，要求匹配替换次数 |
| `run_shell_command` | Shell 执行 | coder 可在 Workspace Grant root 内运行受限命令，带 cwd containment、timeout、输出限制和危险命令拒绝 |
| `git_status` / `git_diff` / `git_log` / `git_show` | Git 只读 | coder 可读取仓库状态、diff、日志和对象内容 |
| `run_typecheck` / `run_tests` / `run_lint` | 验证工具 | coder 可按项目脚本运行类型检查、测试和 lint |
| `list_tool_runs` | 工具审计 | coder 可查看近期工具审计记录 |
| `propose_experience_from_tool_run` | Tool Experience | coder 可从工具审计记录生成待确认的工具行为、失败模式、验证模式或工作流经验 |
| `list_experience_candidates` | Tool Experience | coder 可查看候选、已批准、已拒绝或已 superseded 的工具经验 |
| `review_experience_candidate` | Tool Experience | coder 可在用户确认后审批、拒绝或 supersede 工具经验候选 |

---

## 十一、Agent 与 Tool Registry

| 功能 | 状态 | 说明 |
|---|---|---|
| AgentProfile | 完成 | 已内置 main / coder / researcher / writer 四类 profile |
| 轻量 ToolRegistry | 完成 | `register()` / `get()` / `list()` / `resolve()`，按 allowedTools 过滤工具 |
| AgentRunner 工具注入 | 完成 | subagent 运行时从 ToolRegistry resolve 自己允许的工具 |
| coder 项目只读工具 | 完成 | coder 拥有 `list_project_files` / `read_project_file` / `search_project` |
| researcher 工具隔离 | 完成 | researcher 默认只有 `web_search` / `read_file` |
| writer 工具隔离 | 完成 | writer 默认只有 `write_file`，不加载项目只读工具 |
| 主 Agent 工具 | 完成 | 主 Agent 保持 task/file/delegate 工具，第一版仍由 TaskOrchestrator 注册 |
| 写文件参数校验 | 完成 | `write_file` 缺少文件名或空内容时拒绝写入，避免生成空 `output.txt` |
| coder Shell/Git/验证工具 | 完成 | coder 拥有受限 shell、git 只读、typecheck/test/lint 和项目写入工具 |
| Workspace Grant enforcement | 完成 | 项目写入/patch 需要 `write` grant；shell/typecheck/test/lint 需要 `execute` grant；只读工具可回退 projectRoot |
| subagent 启动先验加载 | 完成 | subagent 启动时加载 Environment Prior 摘要和已批准 Tool Experience，不把低层工具细节塞给主 Agent |
| subagent 连续上下文 | 完成 | AgentRunner 启动时加载当前任务摘要和 Task-scoped Agent Thread，结束后写回结果、工具事件、失败尝试和验证摘要 |
| subagent mode 工具裁剪 | 完成 | `command_only` 只注册 shell 命令工具，`verify` 优先验证工具，减少无关探查和 max_tool_rounds |
| Tool Experience 工具 | 完成 | coder 可把审计证据沉淀为带 scope、evidence、confidence 和 approvalStatus 的工具经验候选 |

文件：`src/core/tools/registry.ts` `src/core/tools/project-read-tools.ts` `src/core/tools/index.ts` `src/core/agents/runner.ts` `src/core/agents/profiles.ts`

---

## 十二、Runtime 系统

| 功能 | 状态 | 说明 |
|---|---|---|
| AugustusRuntime 接口 | 完成 | 定义 `receive()` / `sleep()` / `getStatus()` / `listTasks()` / `getCurrentTask()` / `listMemoryAtoms()` / `listMemoryCandidates()` |
| RuntimeEnvelope / RuntimeResponse | 完成 | 统一输入输出格式，解耦 channel 与核心逻辑 |
| createAugustusRuntime() | 完成 | 集中初始化所有 store、adapter、registry、runner、orchestrator、consolidator |
| start-feishu 瘦身 | 完成 | 飞书入口只负责 channel 适配，业务逻辑走 runtime.receive() |
| Runtime status 查询 | 完成 | 返回 startedAt、uptimeMs、dataDir、projectRoot、sessionsLoaded、llmEnabled |

文件：`src/core/runtime/types.ts` `src/core/runtime/runtime.ts` `src/core/runtime/create-runtime.ts`

---

## 十三、Environment Prior（环境先验）

| 功能 | 状态 | 说明 |
|---|---|---|
| 宿主 OS 探测 | 完成 | platform、release、arch、homedir、tmpdir、timezone、locale |
| Shell 探测 | 完成 | 默认 shell、可用 shell 列表、PowerShell 版本 |
| 网络代理探测 | 完成 | HTTP_PROXY / HTTPS_PROXY / NO_PROXY 等环境变量摘要 |
| Capability Probe | 完成 | 探测 Node/Python/Java/Go/Rust/.NET runtime、npm/pnpm/yarn/pip/conda/poetry 包管理器、git/ssh/curl/rg/jq 开发工具、docker/podman 容器、ffmpeg 等 |
| 摘要生成 | 完成 | 生成 mainSummary（主 Agent 用）、subagentSummary（子 Agent 用）、shellSummary（命令执行用）三类分层摘要 |
| 文件持久化 | 完成 | 写入 `.augustus/environment/host-prior.json`，含过期时间 |
| subagent 启动注入 | 完成 | AgentRunner 启动时自动加载 environment prior 摘要 |

文件：`src/core/environment/types.ts` `src/core/environment/probes.ts` `src/core/environment/probe-runner.ts` `src/core/environment/summary.ts` `src/core/environment/environment-store.ts`

---

## 十四、Tool Experience（工具经验）

| 功能 | 状态 | 说明 |
|---|---|---|
| ExperienceCandidate 类型 | 完成 | 定义 `tool_behavior` / `tool_failure_pattern` / `verification_pattern` / `workflow_pattern` 四种经验类型 |
| 审批状态流转 | 完成 | candidate → approved / rejected / superseded |
| 文件系统存储 | 完成 | `.augustus/experience/{candidate,approved,rejected,superseded}/` 按状态分目录 |
| list_tool_runs | 完成 | coder 可查看近期工具审计记录，按日期和工具名过滤 |
| propose_experience_from_tool_run | 完成 | coder 可从 tool audit 证据生成待确认的工具经验候选 |
| list_experience_candidates | 完成 | 按 kind / approvalStatus / toolName 过滤查看 |
| review_experience_candidate | 完成 | 用户确认后审批/拒绝/supersede 经验候选 |
| subagent 启动注入 | 完成 | AgentRunner 启动时自动加载已批准的工具经验 |

文件：`src/core/experience/types.ts` `src/core/experience/candidate-store.ts` `src/core/tools/experience-tools.ts`

---

## 十五、Tool Audit（工具审计）

| 功能 | 状态 | 说明 |
|---|---|---|
| ToolAuditRecord | 完成 | 记录 toolName、risk、scopes、argsPreview、resultPreview、success/error、latencyMs、traceId/sessionId/taskId/runId/agentType |
| JSONL 持久化 | 完成 | 按日期写入 `.augustus/tool-runs/{date}.jsonl` |
| withToolAudit 包装器 | 完成 | 自动为所有注册工具包装审计逻辑，捕获参数、结果、错误、耗时 |
| 按条件检索 | 完成 | 支持按 dateKey、toolName、limit 过滤查询 |

文件：`src/core/tools/tool-audit.ts` `src/core/tools/tool-result.ts`

---

## 十六、Agent Thread（子Agent 连续上下文）

| 功能 | 状态 | 说明 |
|---|---|---|
| TaskAgentThread | 完成 | 按 taskId + agentType 维护子 Agent 连续上下文 |
| 运行摘要追踪 | 完成 | 记录 recentRuns（最近 8 次）、completedSteps（最近 12 步）、failedAttempts（最近 8 次失败）、verificationNotes、openQuestions |
| 上下文打包 | 完成 | `buildContextPack()` 为 subagent 启动时生成精简上下文摘要 |
| AgentRunner 集成 | 完成 | 每次子 Agent 执行完成后自动写回 thread |

文件：`src/core/agents/agent-thread-store.ts` `src/core/agents/types.ts`

---

## 十七、记忆系统

| 功能 | 状态 | 说明 |
|---|---|---|
| MemoryRawEvent | 完成 | 每轮对话、任务事件、agent run 自动写入 raw event |
| FileSystemMemoryEventStore | 完成 | raw events 按日期写入 `.augustus/memory/raw-events/{date}.json` |
| FileSystemMemoryDigestStore | 完成 | daily digest 持久化 |
| FileSystemMemoryEpisodeStore | 完成 | episode 持久化，含 worldDeltas 状态变化追踪 |
| FileSystemMemoryAtomStore | 完成 | memory atom 持久化，支持 `isActivated` 激活控制、`status` 状态（active/superseded/uncertain/invalid） |
| FileSystemMemoryCandidateStore | 完成 | memory candidate 持久化，支持 pending/consolidated/dismissed 状态 |
| MemoryConsolidator | 完成 | `consolidateDay()` 收集 raw events → 生成 episode → 生成 daily digest → 处理 pending candidates |
| MemoryLoader | 完成 | `buildPromptContext()` 加载 active atoms + 最近 digest，裁剪后注入 system prompt |
| create_memory_candidate 工具 | 完成 | 用户说"记住"时创建高权重候选，不直接写长期记忆 |
| Memory Seed | 完成 | `npm run memory-seed` 预填充 atoms，模拟长期记忆积累 |

文件：`src/core/memory/types.ts` `src/core/memory/event-store.ts` `src/core/memory/digest-store.ts` `src/core/memory/episode-store.ts` `src/core/memory/atom-store.ts` `src/core/memory/candidate-store.ts` `src/core/memory/consolidator.ts` `src/core/memory/loader.ts` `src/core/memory/seed.ts` `src/core/tools/memory-tools.ts`

---

## 十八、数据目录

当前 `.augustus/` 落盘结构：

```text
.augustus/
  tasks/
    active/          # 活跃任务 JSON
    paused/          # 已暂停任务
    done/            # 已完成任务
    archived/        # 已归档任务
  indexes/
    current-task-pointers.json
    task-index.json
  sessions/          # 会话消息 JSON（按 channel:conversationId）
  agent-runs/        # 子 Agent 执行记录（按 taskId）
  agent-threads/     # Task-scoped 子 Agent 连续上下文（按 taskId）
  memory/
    raw-events/      # 原始事件（按日期）
    episodes/        # 情景记忆
    atoms/           # 语义记忆原子
    digests/         # 每日摘要
    candidates/      # 记忆候选
  files/             # 用户附件和生成物
  environment/
    host-prior.json  # 宿主环境能力先验
  experience/        # 工具经验候选
    candidate/
    approved/
    rejected/
    superseded/
  tool-runs/         # 工具审计日志（按日期 JSONL）
  workspace-grants/  # 工作区授权（按 taskId）
```

---

## 已知待办

- [x] SerialQueue 代码去重 — 提取到 `src/utils/serial-queue.ts` 共享
- [x] handleMessageEvent 文件下载时序 — 改为先下载再入队
- [x] 暂停任务目录 — `init()` 创建 `paused/`，`statusDir()` 正确映射
- [x] LLM 读文件工具 — 新增 `read_file` tool，支持文本文件内容读取
- [x] LLM 写文件并发送 — 新增 `write_file` + `send_file` tool，填充 `replyFiles`
- [x] `TaskMetadataService` 接入 — 任务完成时后台自动生成总结/成果/待办
- [x] 会话持久化 — `FileSystemSessionStore` + LoopManager 自动保存/恢复
- [x] LLM 适配器重构 — 抽取 `LLMAdapter` 接口 + `AnthropicAdapter` + `OpenAIAdapter`
- [x] Coder / Researcher / Writer subagent — 独立子 Agent 委托与 AgentRun 持久化
- [x] Task-scoped Agent Thread — 同一任务内为每类 subagent 保留连续上下文
- [x] delegate mode — 按 `command_only` / `inspect_only` / `edit_files` / `implement_feature` / `verify` 裁剪 subagent 工具
- [x] Workspace Grant v0 — 当前任务授权 workspace root，项目写入和 shell 执行按 grant 校验
- [x] Verification Contract v0 — typecheck/test/lint/git diff 写回任务验证状态，暂停/完成时输出结构化验收边界
- [x] Implementation Checkpoint v0 — 创建 pending checkpoint，用户确认后生成 Workspace Grant
- [x] ToolRegistry — 轻量工具注册表，按 AgentProfile.allowedTools 分发工具
- [x] Coder 项目只读工具 — `list_project_files` / `read_project_file` / `search_project`
- [x] 工具调用健壮性 — 参数 JSON 解析失败、空写文件、max_tool_rounds 均可观测并标记失败
- [x] Shell 工具 — 执行本地命令
- [x] Git 工具 — 查看状态/diff/提交
- [x] Environment Prior v0 — 安装/初始化阶段生成宿主能力先验
- [x] Tool Experience v0 — 从 tool audit 生成可审批工具经验候选
- [x] Runtime API v0 — AugustusRuntime 接口 + createAugustusRuntime() 集中初始化
- [x] Tool Audit v0 — 工具审计 JSONL 持久化，withToolAudit 自动包装
- [x] Diagnostics 工具 — `serializeError()` 结构化错误序列化
- [x] Memory Candidate — 创建、持久化、在 sleep 中整理为 atom
- [ ] Memory atom 自动抽取、冲突检测、遗忘策略 — 仍是初步框架
- [ ] Model Router — 实现 `model-router.ts`，支持按任务类型/成本/上下文选模型
- [ ] Skill 目录 — 创建 `skills/{git,coder,research,node-project}/SKILL.md`
- [ ] Companion 自动 skill 选择 — 替代手动 `/cmd` 切换
- [ ] CLI 独立交互工具 — 将 examples 升级为可交互的最小 CLI
- [ ] Server 薄壳 — HTTP/WebSocket API 暴露 runtime 能力
- [ ] Daemon/Worker — 长驻运行 + 定时 sleep
- [ ] 向量检索 — memory recall 辅助手段
- [ ] 流式输出接入 Loop — Loop 层目前未使用 streaming
