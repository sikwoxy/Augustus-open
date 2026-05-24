# Augustus

[English](README.md) | [简体中文](README.zh-CN.md)

Augustus is an experimental, task-first agent runtime.

Agent harnesses have already proved that modern agents need more than prompts: they need tool-call loops, permission gates, execution constraints, memory, and auditability. Augustus starts from that foundation and asks a product question: what should the personal agent runtime look like when everyone has one running across their daily work?

Augustus treats **Task** as the highest-level product concept. Human work is fragmented by nature: a message, a file, a meeting, a bug, a note, a half-finished plan. A runtime should not only answer messages; it should gather these fragments into durable tasks, plan toward goals, coordinate agents, preserve context, record experience, and make outcomes verifiable.

The project is a long-term exploration of that architecture.

## Vision

Augustus explores a runtime layer for personal and team agents:

- task-first work organization
- goal planning and task recovery
- multi-agent delegation
- memory, forgetting, and context selection
- skills and reusable tool experience
- permission-aware tool execution
- verification records and observable process

Systems like OpenClaw show an early shape of this future: autonomous agents connected to real tools, local workspaces, and user-facing channels. Augustus focuses on the product form that can make such runtimes understandable, maintainable, and useful in daily work.

See the architecture vision page: [`docs/agent-runtime-vision.html`](docs/agent-runtime-vision.html).

## Project Architecture

The current project uses a pnpm workspace with three main packages:

```text
Augustus/
  core/      @augustus/core
  backend/   @augustus/backend
  web/       Next.js web app
```

### `@augustus/core`

Runtime library.

Responsibilities:

- runtime interface and factory
- task orchestration
- LLM loop
- sub-agent execution
- memory system
- tool registry and tool audit
- workspace grants and verification records
- shared API contract types

The core package should not depend on HTTP frameworks, web UI frameworks, or channel-specific SDKs.

### `@augustus/backend`

HTTP adapter and server runtime.

Responsibilities:

- Fastify API server
- request ID propagation
- unified API responses
- file upload and preview endpoints
- runtime status and task APIs
- channel integration
- operational commands such as serve, doctor, and smoke

The backend should call the public runtime API instead of reaching into core internals.

### `web`

Optional web interface.

Responsibilities:

- chat workspace
- task list and task details
- runtime status pages
- testing and diagnostics views

The web app should only talk to the backend API. It should not read or write runtime data files directly.

## Runtime Data Flow

```text
User fragment
  -> channel adapter
  -> RuntimeEnvelope
  -> Task
  -> planning / loop / tools / sub-agents
  -> memory, audit, experience, verification
  -> resumable task outcome
```

The long-term direction is to expose this process through runtime events so CLI and Web users can see agent work step by step instead of receiving only the final answer.

## Development

Requirements:

- Node.js 18 or newer
- pnpm 10.x

Install dependencies:

```bash
pnpm install
```

Build all packages:

```bash
pnpm build
```

Run type checks:

```bash
pnpm typecheck
```

Start the backend:

```bash
pnpm dev:backend
```

Start the web app:

```bash
pnpm dev:web
```

Useful package-level commands:

```bash
pnpm --filter @augustus/core build
pnpm --filter @augustus/backend typecheck
pnpm --filter web build
pnpm --filter web lint
```

## Configuration

Create a backend environment file:

```bash
cp backend/.env.example backend/.env
```

If `pnpm dev:backend` reports `LLM_API_KEY missing`, the backend did not load a usable LLM configuration. Create `backend/.env`, then fill in at least `LLM_API_KEY` and `LLM_MODEL`.

Bash:

```bash
cp backend/.env.example backend/.env
```

PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
```

Manual steps:

1. Copy `.env.example` inside the `backend/` directory.
2. Rename the copied file to `.env`.
3. Open `backend/.env` and fill in `LLM_API_KEY` and `LLM_MODEL`.
4. Run `pnpm dev:backend` again.

Common variables:

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

The default runtime data directory is `.augustus/`.

## Current Status

Augustus is under active development. The current implementation includes:

- runtime API
- task persistence
- LLM adapter layer
- multi-turn loop with tool calls
- sub-agent runner
- memory consolidation foundation
- tool audit and tool experience foundation
- Fastify backend
- Next.js web interface
- pnpm workspace development flow

Some areas remain experimental:

- runtime event streaming
- CLI-first process visibility
- long-term memory quality
- model routing
- production deployment flow

## License Direction

The recommended license direction is Apache License 2.0 for source code, plus a separate trademark policy for the Augustus name and branding.

The license should allow commercial use while requiring license and notice preservation. The trademark policy should make clear that the source code may be used commercially, but the Augustus name, logo, and project identity may not be used to imply an official Augustus product, endorsement, or commercial offering without permission.

See `LICENSE-AND-TRADEMARKS.md` for the detailed recommendation and `TRADEMARKS.md` for the draft trademark policy.

## Maintainer Note

Augustus is an exploration of agent runtime as a product and infrastructure category. Contributions should preserve the core direction: durable tasks, visible execution, recoverable context, verifiable outcomes, and clear boundaries between runtime, adapters, and UI.
