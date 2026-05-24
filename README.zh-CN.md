# Augustus

[English](README.md) | [简体中文](README.zh-CN.md)

Augustus 是一个实验性的、以任务为中心的 agent runtime。

Agent harness 已经证明，现代 agent 不能只依赖 prompt：它们需要 tool-call loop、权限门、执行约束、记忆和审计能力。Augustus 从这个基础出发，继续追问一个产品问题：当每个人都会拥有自己的 agent runtime 时，它应该以什么形态参与日常工作？

Augustus 将 **Task** 作为最高等级的产品概念。人的工作天然是片段式的：一条消息、一个文件、一次会议、一个 bug、一段笔记、一个未完成的计划。Runtime 不应该只是回复消息，而应该把这些片段收束为持久任务，围绕目标进行规划，调度多个 agent，保留上下文，沉淀经验，并让结果可以被验证。

这个项目是对这种架构的长期探索。

## 愿景

Augustus 探索面向个人和团队 agent 的 runtime 层：

- 以任务为中心组织工作
- 目标规划和任务恢复
- multi-agent 委托
- 记忆、遗忘和上下文选择
- 技能和可复用工具经验
- 带权限控制的工具执行
- 验证记录和可观察执行过程

OpenClaw 这类系统已经展示了未来的雏形：自主 agent 连接真实工具、本地 workspace 和用户渠道。Augustus 更关注这样的 runtime 如何成为可理解、可维护、能进入日常工作的产品形态。

架构愿景页见：[`docs/agent-runtime-vision.html`](docs/agent-runtime-vision.html)。

## 项目架构

当前项目使用 pnpm workspace，包含三个主要包：

```text
Augustus/
  core/      @augustus/core
  backend/   @augustus/backend
  web/       Next.js web app
```

### `@augustus/core`

Runtime library。

职责：

- runtime 接口和工厂
- 任务编排
- LLM loop
- sub-agent 执行
- 记忆系统
- 工具注册和工具审计
- workspace 授权和验证记录
- 共享 API contract 类型

core 包不应依赖 HTTP 框架、Web UI 框架或特定渠道 SDK。

### `@augustus/backend`

HTTP adapter 和 server runtime。

职责：

- Fastify API server
- requestId 贯穿
- 统一 API response
- 文件上传和预览接口
- runtime 状态和任务 API
- 渠道集成
- serve、doctor、smoke 等运维命令

backend 应调用公开 runtime API，不应直接访问 core 内部实现。

### `web`

可选 Web 界面。

职责：

- Chat 工作台
- 任务列表和任务详情
- runtime 状态页
- 测试和诊断视图

web app 只应调用 backend API，不应直接读写 runtime 数据文件。

## Runtime 数据流

```text
用户工作片段
  -> 渠道 adapter
  -> RuntimeEnvelope
  -> Task
  -> planning / loop / tools / sub-agents
  -> memory、audit、experience、verification
  -> 可恢复的任务结果
```

长期方向是通过 runtime events 暴露执行过程，让 CLI 和 Web 用户能一步步看到 agent 正在做什么，而不是只收到最终答案。

## 开发

要求：

- Node.js 18 或更新版本
- pnpm 10.x

安装依赖：

```bash
pnpm install
```

构建所有包：

```bash
pnpm build
```

运行类型检查：

```bash
pnpm typecheck
```

启动后端：

```bash
pnpm dev:backend
```

启动 Web app：

```bash
pnpm dev:web
```

常用单包命令：

```bash
pnpm --filter @augustus/core build
pnpm --filter @augustus/backend typecheck
pnpm --filter web build
pnpm --filter web lint
```

## 配置

创建 backend 环境变量文件：

```bash
cp backend/.env.example backend/.env
```

如果执行 `pnpm dev:backend` 后看到 `LLM_API_KEY missing`，说明 backend 没有读到可用的 LLM 配置。请先创建 `backend/.env`，然后填写至少 `LLM_API_KEY` 和 `LLM_MODEL`。

Bash:

```bash
cp backend/.env.example backend/.env
```

PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
```

手动操作：

1. 在 `backend/` 目录下复制 `.env.example`。
2. 将复制出来的文件重命名为 `.env`。
3. 打开 `backend/.env`，填写 `LLM_API_KEY` 和 `LLM_MODEL`。
4. 重新执行 `pnpm dev:backend`。

常用变量：

```text
LLM_API_KEY
LLM_MODEL
LLM_PROVIDER
AUGUSTUS_DATA_DIR
AUGUSTUS_SERVER_PORT
AUGUSTUS_SERVER_HOST
AUGUSTUS_AUTH_TOKEN
AUGUSTUS_ALLOWED_ORIGINS
NEXT_PUBLIC_API_URL
```

默认 runtime 数据目录是 `.augustus/`。

## 当前状态

Augustus 正在活跃开发中。当前实现包括：

- runtime API
- 任务持久化
- LLM adapter 层
- 支持 tool call 的多轮 loop
- sub-agent runner
- 记忆整理基础框架
- 工具审计和工具经验基础框架
- Fastify backend
- Next.js web interface
- pnpm workspace 开发流程

仍处于实验阶段的方向：

- runtime event streaming
- CLI-first 过程可见性
- 长期记忆质量
- model routing
- 生产部署流程

## 许可证方向

推荐的许可证方向是：源码使用 Apache License 2.0，同时为 Augustus 名称和品牌制定独立商标政策。

许可证应允许商用，同时要求保留 license 和 notice。商标政策应明确：源码可以商用，但不能在未经许可的情况下使用 Augustus 名称、logo 或项目身份来暗示官方 Augustus 产品、背书或商业发行。

详细建议见 `LICENSE-AND-TRADEMARKS.md`，商标政策草案见 `TRADEMARKS.md`。

## 维护者说明

Augustus 是对 agent runtime 作为产品和基础设施类别的探索。贡献应保持核心方向：持久任务、可见执行、可恢复上下文、可验证结果，以及 runtime、adapter 和 UI 之间的清晰边界。
