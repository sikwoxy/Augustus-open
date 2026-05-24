// ═══════════════════════════════════════════════
// Fastify HTTP Server Adapter
//
// 唯一的 HTTP 外壳。所有 route 通过
// AugustusRuntime 接口调用，不直接碰内部实现。
// ═══════════════════════════════════════════════

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { v4 as uuidv4 } from "uuid";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, readdir, mkdir, rm } from "node:fs/promises";
import { resolve, basename, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AugustusRuntime } from "@augustus/core";
import type {
  ApiErrorCode,
  ApiResponse,
  ChatRequest,
  ChatResponse,
  HealthResponse,
  ReadyCheck,
  ReadyResponse,
  SleepResponse,
  StatusResponse,
  ContextListResponse,
  ContextDetailResponse,
  TaskListResponse,
  TaskDetailResponse,
} from "@augustus/core";
import { logger, chatLog } from "./logger";

// ─── 环境变量 ───

const PORT = parseInt(process.env.AUGUSTUS_SERVER_PORT ?? "3001", 10);
const HOST = process.env.AUGUSTUS_SERVER_HOST ?? "127.0.0.1";
const BODY_LIMIT = parseInt(process.env.AUGUSTUS_BODY_LIMIT ?? "10485760", 10);
const ALLOWED_ORIGINS = (process.env.AUGUSTUS_ALLOWED_ORIGINS ?? "http://localhost:3001")
  .split(",")
  .map((s) => s.trim());
const AUTH_TOKEN = process.env.AUGUSTUS_AUTH_TOKEN;

async function isOriginAllowed(origin: string | undefined): Promise<boolean> {
  if (!origin) return true; // same-origin / non-browser requests
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

// ─── Helpers ───

function ok<T>(requestId: string, data: T): ApiResponse<T> {
  return { ok: true, requestId, data };
}

function fail(requestId: string, code: ApiErrorCode, message: string, details?: unknown): ApiResponse<never> {
  return { ok: false, requestId, error: { code, message, details } };
}

function extractRequestId(req: FastifyRequest): string {
  return (req.headers["x-request-id"] as string) ?? uuidv4();
}

function toTaskSummary(task: {
  id: string;
  title: string;
  status: "active" | "paused" | "done" | "archived";
  goal?: string;
  summary?: string;
  updatedAt: number;
  createdAt: number;
  ownerUserId: string;
  channels: Array<{ channel: string; conversationId: string; joinedAt: number }>;
  todos?: string[];
  artifacts?: Array<{ type: string; uri: string; description?: string; createdAt: number }>;
}) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    goal: task.goal,
    summary: task.summary,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    ownerUserId: task.ownerUserId,
    channels: task.channels.map((c) => ({
      channel: c.channel as "cli" | "feishu" | "wechat" | "web" | "qq",
      conversationId: c.conversationId,
      joinedAt: c.joinedAt,
    })),
    todos: task.todos,
    artifacts: task.artifacts,
  };
}

// ─── Server 工厂 ───

export interface CreateServerOptions {
  runtime: AugustusRuntime;
  /** 测试专用 Runtime（dataDir: .augustus-test/），通过 x-augustus-test-mode 请求头路由 */
  testRuntime?: AugustusRuntime;
  version?: string;
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const { runtime: defaultRuntime, testRuntime, version } = options;

  /** 根据请求头或 query 参数解析使用哪个 Runtime */
  function resolveRuntime(req: FastifyRequest): AugustusRuntime {
    const query = (req.query as Record<string, string | undefined>) ?? {};
    if (testRuntime && (req.headers["x-augustus-test-mode"] === "true" || query.test === "true")) {
      return testRuntime;
    }
    return defaultRuntime;
  }

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT,
  });

  await app.register(cors, {
    origin: isOriginAllowed,
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // ─── Request logging + response header ───

  app.addHook("onResponse", async (req, reply) => {
    const requestId = extractRequestId(req);
    reply.header("x-request-id", requestId);
    logger.info("request completed", {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
    });
  });

  // ─── Auth (可选) ───

  if (AUTH_TOKEN) {
    app.addHook("onRequest", async (req, reply) => {
      const token = req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
      if (token !== AUTH_TOKEN) {
        reply.code(401).send(fail(extractRequestId(req), "BAD_REQUEST", "Unauthorized"));
      }
    });
  }

  // ─── GET /healthz ───

  app.get("/healthz", async (req) => {
    const requestId = extractRequestId(req);
    const data: HealthResponse = { status: "ok" };
    return ok(requestId, data);
  });

  // ─── GET /readyz ───

  app.get("/readyz", async (req) => {
    const requestId = extractRequestId(req);
    const checks: ReadyCheck[] = [];

    try {
      const status = await resolveRuntime(req).getStatus();
      checks.push({
        name: "dataDir",
        ok: !!status.dataDir,
        message: `dataDir: ${status.dataDir}`,
      });
    } catch {
      checks.push({ name: "dataDir", ok: false, message: "failed to read dataDir" });
    }

    const hasKey = !!process.env.LLM_API_KEY;
    const hasModel = !!process.env.LLM_MODEL;
    checks.push({
      name: "llm",
      ok: hasKey && hasModel,
      message: [hasKey ? "" : "LLM_API_KEY missing", hasModel ? "" : "LLM_MODEL missing"]
        .filter(Boolean)
        .join("; ") || `LLM configured (model: ${process.env.LLM_MODEL})`,
    });

    const feishuOk = !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET;
    checks.push({
      name: "feishu",
      ok: feishuOk,
      message: feishuOk ? "Feishu configured" : "Feishu not configured (optional)",
    });

    const allOk = checks.every((c) => c.ok || c.name === "feishu");
    const data: ReadyResponse = { ready: allOk, checks };
    logger.info("readyz check", { requestId, ready: allOk });
    return ok(requestId, data);
  });

  // ─── GET /v1/status ───

  app.get("/v1/status", async (req) => {
    const requestId = extractRequestId(req);
    const runtimeStatus = await resolveRuntime(req).getStatus();
    const data: StatusResponse = { ...runtimeStatus, version };
    return ok(requestId, data);
  });

  // ─── GET /v1/config ───

  app.get("/v1/config", async (req) => {
    const requestId = extractRequestId(req);
    const provider = process.env.LLM_PROVIDER
      || (process.env.LLM_MODEL?.startsWith("deepseek-") ? "openai"
        : process.env.LLM_MODEL?.startsWith("gpt-") ? "openai"
        : process.env.LLM_BASE_URL?.includes("/v1") ? "openai"
        : "anthropic");
    const webSearchSupported = provider === "anthropic" && !process.env.AUGUSTUS_WEB_SEARCH_DISABLED;
    return ok(requestId, {
      provider,
      model: process.env.LLM_MODEL || "(未设置)",
      baseUrl: process.env.LLM_BASE_URL || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"),
      webSearchSupported,
      agentConfigs: {
        main: {
          provider: process.env.AUGUSTUS_MAIN_PROVIDER || provider,
          model: process.env.AUGUSTUS_MAIN_MODEL || process.env.LLM_MODEL || "(未设置)",
        },
        coder: {
          provider: process.env.AUGUSTUS_CODER_PROVIDER || provider,
          model: process.env.AUGUSTUS_CODER_MODEL || process.env.LLM_MODEL || "(未设置)",
        },
        researcher: {
          provider: process.env.AUGUSTUS_RESEARCHER_PROVIDER || provider,
          model: process.env.AUGUSTUS_RESEARCHER_MODEL || process.env.LLM_MODEL || "(未设置)",
        },
        writer: {
          provider: process.env.AUGUSTUS_WRITER_PROVIDER || provider,
          model: process.env.AUGUSTUS_WRITER_MODEL || process.env.LLM_MODEL || "(未设置)",
        },
      },
      envFile: ".env.example",
    });
  });

  // ─── POST /v1/chat ───

  app.post("/v1/chat", async (req: FastifyRequest<{ Body: ChatRequest }>, reply) => {
    const startedAt = Date.now();
    const requestId = extractRequestId(req);
    const body = req.body;

    if (!body || typeof body !== "object") {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "Request body is required");
    }

    const forbiddenInstructionKeys = ["system", "developer", "role", "messages", "tools", "tool_choice"];
    const bodyRecord = body as unknown as Record<string, unknown>;
    const injectedKeys = forbiddenInstructionKeys.filter((key) =>
      Object.prototype.hasOwnProperty.call(bodyRecord, key),
    );
    if (injectedKeys.length > 0) {
      reply.code(400);
      return fail(
        requestId,
        "BAD_REQUEST",
        "Request body contains reserved instruction fields",
        { fields: injectedKeys },
      );
    }

    const conversationId = body.conversationId;
    if (!conversationId || typeof conversationId !== "string" || conversationId.trim().length === 0) {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "conversationId is required");
    }

    const text = body.text;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "text is required and cannot be empty");
    }

    const channel = (body.channel ?? "web") as "web" | "cli" | "feishu";
    const userId = body.userId ?? "local-user";

    const files = body.files?.map((f) => ({
      fileName: f.fileName,
      localPath: f.localPath,
      size: f.size,
      mimeType: f.mimeType,
      sourceKey: f.sourceKey,
      sourceType: (f.sourceType ?? "file") as "file" | "image" | "audio" | "video",
    }));

    const metadata = { ...body.metadata, requestId };

    try {
      const result = await resolveRuntime(req).receive({
        channel: channel as "web",
        userId,
        conversationId,
        text,
        timestamp: Date.now(),
        agentHint: body.agentHint,
        files,
        metadata,
      });

      const latencyMs = Date.now() - startedAt;

      const data: ChatResponse = {
        text: result.text,
        taskId: result.taskId,
        taskStatus: result.taskStatus,
        usage: result.usage,
        latencyMs,
        replyFiles: result.replyFiles?.map((f) => ({
          fileName: f.fileName,
          localPath: f.localPath,
          size: f.size,
          mimeType: f.mimeType,
          sourceKey: f.sourceKey,
          sourceType: f.sourceType,
        })),
        events: result.events,
        diagnostics: result.rawResult?.diagnostics,
      };

      chatLog({ requestId, channel, conversationId, taskId: result.taskId, taskStatus: result.taskStatus, latencyMs });

      return ok(requestId, data);
    } catch {
      const latencyMs = Date.now() - startedAt;
      logger.error("chat failed", { requestId, channel, conversationId, latencyMs });
      reply.code(500);
      return fail(requestId, "RUNTIME_ERROR", "Runtime processing failed");
    }
  });

  // ─── GET /v1/tasks ───

  app.get("/v1/tasks", async (req) => {
    const requestId = extractRequestId(req);
    const tasks = await resolveRuntime(req).listTasks();
    const data: TaskListResponse = { tasks: tasks.map(toTaskSummary) };
    return ok(requestId, data);
  });

  // ─── GET /v1/tasks/current ───

  app.get("/v1/tasks/current", async (req, reply) => {
    const requestId = extractRequestId(req);
    const query = req.query as Record<string, string | undefined>;
    const userId = query.userId ?? "local-user";
    const channel = (query.channel ?? "web") as "cli" | "feishu" | "wechat" | "web" | "qq";
    const conversationId = query.conversationId;

    if (!conversationId) {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "conversationId query parameter is required");
    }

    const task = await resolveRuntime(req).getCurrentTask({ userId, channel, conversationId });
    if (!task) {
      return ok(requestId, null);
    }
    return ok(requestId, toTaskSummary(task));
  });

  // ─── GET /v1/tasks/:taskId ───

  app.get("/v1/tasks/:taskId", async (req, reply) => {
    const requestId = extractRequestId(req);
    const params = req.params as Record<string, string>;
    const taskId = params.taskId;

    if (!taskId) {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "taskId is required");
    }

    const tasks = await resolveRuntime(req).listTasks();
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      reply.code(404);
      return fail(requestId, "TASK_NOT_FOUND", `Task ${taskId} not found`);
    }

    const summary = toTaskSummary(task);
    const detail: TaskDetailResponse = {
      task: {
        ...summary,
        outcome: task.outcome,
        decisions: task.decisions,
        usedAgents: task.usedAgents,
        skills: task.skills,
        verificationState: task.verificationState,
      },
    };
    return ok(requestId, detail);
  });

  // ─── GET /v1/contexts ───

  app.get("/v1/contexts", async (req) => {
    const requestId = extractRequestId(req);
    const query = req.query as Record<string, string | undefined>;
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const contexts = await resolveRuntime(req).listWorkingContexts({
      channel: query.channel as "cli" | "feishu" | "wechat" | "web" | "qq" | undefined,
      userId: query.userId,
      taskId: query.taskId,
      kind: query.kind as "task_related" | "temporary" | "all" | undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const data: ContextListResponse = { contexts };
    return ok(requestId, data);
  });

  // ─── GET /v1/contexts/:contextId ───

  app.get("/v1/contexts/:contextId", async (req, reply) => {
    const requestId = extractRequestId(req);
    const params = req.params as Record<string, string>;
    const contextId = params.contextId ? decodeURIComponent(params.contextId) : "";

    if (!contextId) {
      reply.code(400);
      return fail(requestId, "BAD_REQUEST", "contextId is required");
    }

    const context = await resolveRuntime(req).getWorkingContext(contextId);
    if (!context) {
      reply.code(404);
      return fail(requestId, "CONTEXT_NOT_FOUND", `Context ${contextId} not found`);
    }

    const data: ContextDetailResponse = { context };
    return ok(requestId, data);
  });

  // ─── POST /v1/sleep ───

  app.post("/v1/sleep", async (req) => {
    const requestId = extractRequestId(req);
    const body = req.body as Record<string, unknown> | undefined;

    const result = await resolveRuntime(req).sleep(body?.dateKey ? { dateKey: body.dateKey as string } : undefined);
    const data: SleepResponse = { dateKey: result.dateKey };
    logger.info("sleep completed", { requestId, dateKey: result.dateKey });
    return ok(requestId, data);
  });

  // ─── File endpoints ───

  // 从 task pointer 解析 workspace 根目录
  async function resolveWorkspaceRootForRequest(
    req: FastifyRequest,
  ): Promise<string | null> {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    if (query.taskId) {
      const tasks = await resolveRuntime(req).listTasks();
      const task = tasks.find((item) => item.id === query.taskId);
      const ref =
        task?.workspaceRefs?.find((r) => r.kind === "task_workspace") ??
        task?.workspaceRefs?.find((r) => r.label === "default");
      return ref ? resolve(ref.root) : null;
    }

    const userId = (query.userId ?? "local-user") as string;
    const channel = (query.channel ?? "web") as "cli" | "feishu" | "wechat" | "web" | "qq";
    const conversationId = query.conversationId;
    if (!conversationId) return null;

    const task = await resolveRuntime(req).getCurrentTask({ userId, channel, conversationId });
    if (!task) return null;

    const defaultRef =
      task.workspaceRefs?.find((r) => r.kind === "task_workspace") ??
      task.workspaceRefs?.find((r) => r.label === "default");
    return defaultRef ? resolve(defaultRef.root) : null;
  }

  // POST /v1/files/upload — 上传文件到当前 task workspace 的 _uploads/（无活跃任务时降级到 staging）
  app.post("/v1/files/upload", async (req, reply) => {
    const requestId = extractRequestId(req);
    try {
      const data = await req.file();
      if (!data) {
        reply.code(400);
        return fail(requestId, "BAD_REQUEST", "No file uploaded");
      }

      const safeName = data.filename.replace(/[/\\:*?"<>|]/g, "_");
      const workspaceRoot = await resolveWorkspaceRootForRequest(req);
      let destPath: string;
      let localPath: string;

      if (workspaceRoot) {
        const uploadsDir = resolve(workspaceRoot, "_uploads");
        await mkdir(uploadsDir, { recursive: true });
        destPath = resolve(uploadsDir, safeName);
        if (!destPath.startsWith(uploadsDir + sep) && destPath !== uploadsDir) {
          reply.code(403);
          return fail(requestId, "BAD_REQUEST", "Invalid file name");
        }
        localPath = `_uploads/${safeName}`;
      } else {
        // 无活跃任务时降级到 dataDir/files/_staging/
        const dataDir = (await resolveRuntime(req).getStatus()).dataDir;
        const stagingDir = resolve(dataDir, "files", "_staging");
        await mkdir(stagingDir, { recursive: true });
        destPath = resolve(stagingDir, safeName);
        localPath = destPath; // 绝对路径，供后续 read_file 使用
      }

      await pipeline(data.file, createWriteStream(destPath));

      const info = await stat(destPath);
      logger.info("file uploaded", { requestId, fileName: safeName, size: info.size, hasWorkspace: !!workspaceRoot });

      return ok(requestId, {
        fileName: safeName,
        localPath,
        size: info.size,
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        reply.code(413);
        return fail(requestId, "PAYLOAD_TOO_LARGE", "File too large (max 10MB)");
      }
      reply.code(500);
      return fail(requestId, "INTERNAL_ERROR", "Upload failed");
    }
  });

  // GET /v1/files/:fileName — 下载/预览 workspace 内文件
  app.get("/v1/files/:fileName", async (req, reply) => {
    const requestId = extractRequestId(req);
    const { fileName } = req.params as { fileName: string };

    const workspaceRoot = await resolveWorkspaceRootForRequest(req);

    let filePath: string | null = null;

    if (workspaceRoot) {
      // 在 _output/ 和 _uploads/ 中搜索文件
      const searchDirs = [
        resolve(workspaceRoot, "_output"),
        resolve(workspaceRoot, "_uploads"),
        workspaceRoot,
      ];
      for (const dir of searchDirs) {
        const candidate = resolve(dir, fileName);
        try {
          const info = await stat(candidate);
          if (info.isFile()) {
            filePath = candidate;
            break;
          }
        } catch {
          // 不存在，继续搜索
        }
      }
    }

    // 兼容早期版本 + staging：write_file 曾把发送文件放在 dataDir/files/；无活跃任务时上传到 _staging/
    if (!filePath) {
      const dataDir = (await resolveRuntime(req).getStatus()).dataDir;
      const searchRoots = [resolve(dataDir, "files"), resolve(dataDir, "files", "_staging")];
      for (const searchRoot of searchRoots) {
        const candidate = resolve(searchRoot, fileName);
        if (candidate.startsWith(searchRoot + sep) || candidate === searchRoot) {
          try {
            const info = await stat(candidate);
            if (info.isFile()) {
              filePath = candidate;
              break;
            }
          } catch {
            // 不存在，继续搜索
          }
        }
      }
    }

    if (!filePath) {
      reply.code(404);
      return fail(requestId, "TASK_NOT_FOUND", "File not found");
    }

    try {
      const info = await stat(filePath);
      const ext = basename(fileName).split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        html: "text/html; charset=utf-8",
        htm: "text/html; charset=utf-8",
        css: "text/css; charset=utf-8",
        js: "application/javascript; charset=utf-8",
        json: "application/json; charset=utf-8",
        txt: "text/plain; charset=utf-8",
        md: "text/markdown; charset=utf-8",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        pdf: "application/pdf",
      };
      const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";

      reply.header("Content-Type", contentType);
      reply.header("Content-Length", info.size);
      reply.header("Cache-Control", "public, max-age=3600");
      return reply.send(createReadStream(filePath));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reply.code(404);
        return fail(requestId, "TASK_NOT_FOUND", "File not found");
      }
      reply.code(500);
      return fail(requestId, "INTERNAL_ERROR", "Failed to read file");
    }
  });

  // GET /v1/files — 列出 workspace 下 _output/ 和 _uploads/ 中的文件
  app.get("/v1/files", async (req, reply) => {
    const requestId = extractRequestId(req);
    try {
      const workspaceRoot = await resolveWorkspaceRootForRequest(req);
      if (!workspaceRoot) {
        return ok(requestId, { files: [] });
      }

      const dirs = ["_output", "_uploads"];
      const allFiles: Array<{
        fileName: string;
        size: number;
        createdAt: number;
        modifiedAt: number;
      }> = [];

      for (const sub of dirs) {
        const dirPath = resolve(workspaceRoot, sub);
        try {
          const entries = await readdir(dirPath, { withFileTypes: true });
          for (const e of entries) {
            if (!e.isFile()) continue;
            const info = await stat(resolve(dirPath, e.name));
            allFiles.push({
              fileName: `${sub}/${e.name}`,
              size: info.size,
              createdAt: info.birthtimeMs,
              modifiedAt: info.mtimeMs,
            });
          }
        } catch {
          // 目录不存在则跳过
        }
      }

      return ok(requestId, { files: allFiles });
    } catch {
      return ok(requestId, { files: [] });
    }
  });

  // ─── Admin / Reset ───

  // POST /v1/admin/reset — 重置测试环境，清理 .augustus/ 下所有数据
  app.post("/v1/admin/reset", async (req, reply) => {
    const requestId = extractRequestId(req);
    const body = req.body as Record<string, unknown> | undefined;
    const keep = Array.isArray(body?.keep) ? (body!.keep as string[]) : [];

    try {
      const dataDir = (await resolveRuntime(req).getStatus()).dataDir;
      const subdirs = [
        "tasks", "sessions", "agent-runs", "agent-threads",
        "workspace-grants", "implementation-checkpoints", "indexes",
        "memory", "files", "workspaces", "experience", "tool-runs",
      ];

      const deleted: string[] = [];
      const kept: string[] = [];

      for (const name of subdirs) {
        if (keep.includes(name)) {
          kept.push(name);
          continue;
        }
        try {
          await rm(resolve(dataDir, name), { recursive: true, force: true });
          deleted.push(name);
        } catch {
          // 目录不存在则跳过
        }
      }

      logger.info("test environment reset", { requestId, deleted, kept });
      return ok(requestId, { deleted, kept });
    } catch (err: unknown) {
      logger.error("reset failed", { requestId, message: String(err) });
      reply.code(500);
      return fail(requestId, "INTERNAL_ERROR", "Reset failed");
    }
  });

  // ─── Error handler ───

  app.setErrorHandler((error, req, reply) => {
    const requestId = extractRequestId(req);
    const err = error as { message?: string; validation?: unknown; statusCode?: number };
    logger.error("unhandled error", { requestId, message: err.message ?? "unknown" });

    if (err.validation) {
      reply.code(400).send(fail(requestId, "BAD_REQUEST", err.message ?? "Validation error"));
      return;
    }
    if (err.statusCode === 413) {
      reply.code(413).send(fail(requestId, "PAYLOAD_TOO_LARGE", "Request body too large"));
      return;
    }
    reply.code(500).send(fail(requestId, "INTERNAL_ERROR", "Internal server error"));
  });

  // ─── 404 ───

  app.setNotFoundHandler((req, reply) => {
    const requestId = extractRequestId(req);
    reply.code(404).send(fail(requestId, "BAD_REQUEST", `Route ${req.method} ${req.url} not found`));
  });

  return app;
}

// ─── 启动函数 ───

export interface StartServerOptions extends CreateServerOptions {
  port?: number;
  host?: string;
}

export async function startServer(options: StartServerOptions): Promise<FastifyInstance> {
  const app = await createServer(options);

  const port = options.port ?? PORT;
  const host = options.host ?? HOST;

  await app.listen({ port, host });
  logger.info("server started", { host, port, version: options.version });

  // 优雅关闭由 CLI 层统一管理，这里仅关闭 HTTP server
  const shutdown = async () => {
    logger.info("server closing");
    await app.close();
  };

  process.once("SIGTERM", () => shutdown());
  process.once("SIGINT", () => shutdown());

  return app;
}
