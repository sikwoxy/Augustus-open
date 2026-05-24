// ═══════════════════════════════════════════════
// Backend Smoke Test
//
// 通过 Fastify app.inject() 验证所有 13 个路由。
// 不启动 TCP 端口，零网络开销。
// 使用 .augustus-test 数据目录，不污染正式数据。
// ═══════════════════════════════════════════════

import { createAugustusRuntime } from "@augustus/core";
import type { FastifyInstance } from "fastify";
import { createServer } from "./server";

const PKG_VERSION = "1.0.0";

// ─── 类型 ───

interface SmokeCase {
  method: string;
  route: string;
  label: string;
  run: (app: FastifyInstance) => Promise<Omit<SmokeLine, "method" | "route" | "label">>;
  dependsOn?: string; // 依赖的前置 case label
}

interface SmokeLine {
  method: string;
  route: string;
  label: string;
  result: "PASS" | "FAIL" | "SKIP";
  statusCode: number;
  latencyMs: number;
  message: string;
  requestId?: string;
  detail?: string;
}

interface SmokeReport {
  lines: SmokeLine[];
  passed: number;
  failed: number;
  skipped: number;
  totalLatencyMs: number;
}

// ─── 工具函数 ───

const TEST_HEADERS = { "x-augustus-test-mode": "true" };

function buildMultipartBody(fileName: string, content: string, boundary: string): Buffer {
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: text/plain`,
    "",
    content,
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(parts.join("\r\n"), "utf-8");
}

function fmtLatency(ms: number): string {
  if (ms < 10) return `${ms}ms`;
  if (ms < 100) return `${ms}ms`;
  return `${ms}ms`;
}

function fmtStatus(code: number): string {
  if (code >= 200 && code < 300) return String(code);
  return String(code);
}

// 检查统一 response 格式
function checkResponseFormat(body: unknown): string | null {
  if (!body || typeof body !== "object") return "response body is not an object";
  const b = body as Record<string, unknown>;
  if (typeof b.ok !== "boolean") return "missing 'ok' field";
  if (typeof b.requestId !== "string") return "missing 'requestId' field";
  if (b.ok === true && !("data" in b)) return "ok=true but missing 'data'";
  if (b.ok === false && !b.error) return "ok=false but missing 'error'";
  if (b.ok === false && b.error && typeof (b.error as Record<string, unknown>)?.code !== "string") {
    return "error missing 'code'";
  }
  return null;
}

// ─── 定义所有测试用例 ───

function defineCases(verbose: boolean): SmokeCase[] {
  let uploadedFileName: string | null = null;
  let llmConfigured: boolean | null = null;
  const fileQuery = "userId=smoke-tester&channel=web&conversationId=smoke-test";

  const cases: SmokeCase[] = [
    // ─── 基础存活 ───
    {
      method: "GET",
      route: "/healthz",
      label: "存活检查",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/healthz", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (res.statusCode !== 200) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 200`, requestId: body.requestId, detail: verbose ? res.body : undefined };
        if (body.data?.status !== "ok") return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `data.status 不是 ok`, requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `status=${body.data.status}`, requestId: body.requestId };
      },
    },

    // ─── 就绪检查 ───
    {
      method: "GET",
      route: "/readyz",
      label: "就绪检查",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/readyz", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        const checks = body.data?.checks as Array<{ name: string; ok: boolean }> | undefined;
        if (!checks) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "missing checks", requestId: body.requestId, detail: verbose ? res.body : undefined };

        // 探测 LLM 是否配置，供后续 chat 测试使用
        const llmCheck = checks.find((c) => c.name === "llm");
        llmConfigured = llmCheck?.ok ?? false;

        const failed = checks.filter((c) => c.name !== "feishu" && !c.ok);
        if (failed.length > 0) {
          return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `${failed.map((c) => c.name).join(", ")} 未就绪`, requestId: body.requestId, detail: verbose ? res.body : undefined };
        }
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${checks.length} checks`, requestId: body.requestId };
      },
    },

    // ─── Runtime 状态 ───
    {
      method: "GET",
      route: "/v1/status",
      label: "Runtime 状态",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/v1/status", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        const d = body.data;
        if (!d || typeof d.uptimeMs !== "number" || typeof d.dataDir !== "string") {
          return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 uptimeMs/dataDir", requestId: body.requestId, detail: verbose ? res.body : undefined };
        }
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `uptime=${d.uptimeMs}ms, sessions=${d.sessionsLoaded}, llm=${d.llmEnabled}`, requestId: body.requestId };
      },
    },

    // ─── LLM 配置 ───
    {
      method: "GET",
      route: "/v1/config",
      label: "LLM 配置",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/v1/config", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        const d = body.data;
        if (!d || typeof d.provider !== "string" || typeof d.model !== "string") {
          return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 provider/model", requestId: body.requestId, detail: verbose ? res.body : undefined };
        }
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `provider=${d.provider}, model=${d.model}`, requestId: body.requestId };
      },
    },

    // ─── 对话（依赖 LLM） ───
    {
      method: "POST",
      route: "/v1/chat",
      label: "对话",
      async run(app) {
        if (!llmConfigured) {
          return { result: "SKIP", statusCode: 0, latencyMs: 0, message: "LLM 未配置" };
        }
        const start = Date.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/chat",
          headers: { ...TEST_HEADERS, "content-type": "application/json" },
          body: { text: "Hello, 请用中文回复'冒烟测试通过'", conversationId: "smoke-test", channel: "web", userId: "smoke-tester" },
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (res.statusCode !== 200) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 200`, requestId: body.requestId, detail: verbose ? res.body : undefined };
        const d = body.data;
        if (!d || typeof d.text !== "string") return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 text", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `taskId=${d.taskId?.slice(0, 8) ?? "?"}, latency=${d.latencyMs}ms, tokens=${d.usage?.input ?? 0}+${d.usage?.output ?? 0}`, requestId: body.requestId, detail: verbose ? JSON.stringify({ text: d.text.slice(0, 200), usage: d.usage, diagnostics: d.diagnostics }, null, 2) : undefined };
      },
    },

    // ─── 任务列表 ───
    {
      method: "GET",
      route: "/v1/tasks",
      label: "任务列表",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/v1/tasks", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (!Array.isArray(body.data?.tasks)) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "tasks 不是数组", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${body.data.tasks.length} tasks`, requestId: body.requestId };
      },
    },

    // ─── 当前任务 ───
    {
      method: "GET",
      route: "/v1/tasks/current",
      label: "当前任务",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({
          method: "GET",
          url: "/v1/tasks/current?userId=smoke-tester&channel=web&conversationId=smoke-test",
          headers: TEST_HEADERS,
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: body.data ? `taskId=${(body.data as { id: string }).id.slice(0, 8)}` : "无当前任务", requestId: body.requestId };
      },
    },

    // ─── 任务详情（不存在） ───
    {
      method: "GET",
      route: "/v1/tasks/nonexist",
      label: "任务详情 (404)",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/v1/tasks/nonexist", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        if (res.statusCode !== 404) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "期望 404", detail: verbose ? res.body : undefined };
        if (body.ok !== false) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "期望 ok=false", detail: verbose ? res.body : undefined };
        if (body.error?.code !== "TASK_NOT_FOUND") return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 TASK_NOT_FOUND, 实际 ${body.error?.code}`, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: "TASK_NOT_FOUND", requestId: body.requestId };
      },
    },

    // ─── 工作上下文列表 ───
    {
      method: "GET",
      route: "/v1/contexts",
      label: "工作上下文列表",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({
          method: "GET",
          url: "/v1/contexts?channel=web&userId=smoke-tester&kind=all&limit=20",
          headers: TEST_HEADERS,
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (!Array.isArray(body.data?.contexts)) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "contexts 不是数组", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${body.data.contexts.length} contexts`, requestId: body.requestId };
      },
    },

    // ─── 工作上下文详情（不存在） ───
    {
      method: "GET",
      route: "/v1/contexts/nonexist",
      label: "工作上下文详情 (404)",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: "/v1/contexts/nonexist", headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        if (res.statusCode !== 404) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "期望 404", detail: verbose ? res.body : undefined };
        if (body.ok !== false || body.error?.code !== "CONTEXT_NOT_FOUND") {
          return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 CONTEXT_NOT_FOUND, 实际 ${body.error?.code}`, detail: verbose ? res.body : undefined };
        }
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: "CONTEXT_NOT_FOUND", requestId: body.requestId };
      },
    },

    // ─── Memory Consolidation ───
    {
      method: "POST",
      route: "/v1/sleep",
      label: "记忆整理",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/sleep",
          headers: { ...TEST_HEADERS, "content-type": "application/json" },
          body: {},
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (!body.data?.dateKey) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 dateKey", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `dateKey=${body.data.dateKey}`, requestId: body.requestId };
      },
    },

    // ─── 文件列表 ───
    {
      method: "GET",
      route: "/v1/files",
      label: "文件列表",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({ method: "GET", url: `/v1/files?${fileQuery}`, headers: TEST_HEADERS });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (!Array.isArray(body.data?.files)) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "files 不是数组", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${body.data.files.length} files`, requestId: body.requestId };
      },
    },

    // ─── 上传文件 ───
    {
      method: "POST",
      route: "/v1/files/upload",
      label: "上传文件",
      async run(app) {
        const boundary = "smoke-boundary-001";
        const multipartBody = buildMultipartBody("smoke-test.txt", "hello augustus smoke test", boundary);
        const start = Date.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/files/upload",
          headers: { ...TEST_HEADERS, "content-type": `multipart/form-data; boundary=${boundary}` },
          body: multipartBody,
          query: { userId: "smoke-tester", channel: "web", conversationId: "smoke-test" },
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (res.statusCode !== 200) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `上传失败: ${body.error?.message ?? body}`, requestId: body.requestId, detail: verbose ? res.body : undefined };
        uploadedFileName = body.data?.fileName;
        if (!uploadedFileName) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 fileName", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${uploadedFileName} (${body.data.size} bytes)`, requestId: body.requestId };
      },
    },

    // ─── 下载文件 ───
    {
      method: "GET",
      route: `/v1/files/${encodeURIComponent(uploadedFileName || "smoke-test.txt")}`,
      label: "下载文件",
      async run(app) {
        if (!uploadedFileName) {
          return { result: "SKIP", statusCode: 0, latencyMs: 0, message: "依赖上传文件测试" };
        }
        const start = Date.now();
        const res = await app.inject({
          method: "GET",
          url: `/v1/files/${encodeURIComponent(uploadedFileName)}?${fileQuery}`,
          headers: TEST_HEADERS,
        });
        const latency = Date.now() - start;
        if (res.statusCode !== 200) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 200, got ${res.statusCode}`, detail: verbose ? res.body.slice(0, 200) : undefined };
        if (!res.body.includes("hello augustus")) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "内容不匹配", detail: verbose ? res.body.slice(0, 200) : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `${res.body.length} bytes` };
      },
    },

    // ─── 下载不存在的文件 ───
    {
      method: "GET",
      route: "/v1/files/nonexist.xyz",
      label: "下载文件 (404)",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({
          method: "GET",
          url: `/v1/files/nonexist.xyz?${fileQuery}`,
          headers: TEST_HEADERS,
        });
        const latency = Date.now() - start;
        if (res.statusCode !== 404) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `期望 404, got ${res.statusCode}` };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: "404 (expected)" };
      },
    },

    // ─── 重置测试环境 ───
    {
      method: "POST",
      route: "/v1/admin/reset",
      label: "重置测试环境",
      async run(app) {
        const start = Date.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/admin/reset",
          headers: { ...TEST_HEADERS, "content-type": "application/json" },
          body: {},
        });
        const latency = Date.now() - start;
        const body = JSON.parse(res.body);
        const fmtErr = checkResponseFormat(body);
        if (fmtErr) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: `格式错误: ${fmtErr}`, detail: verbose ? res.body : undefined };
        if (!Array.isArray(body.data?.deleted)) return { result: "FAIL", statusCode: res.statusCode, latencyMs: latency, message: "缺少 deleted", requestId: body.requestId, detail: verbose ? res.body : undefined };
        return { result: "PASS", statusCode: res.statusCode, latencyMs: latency, message: `已清理 ${body.data.deleted.length} 个目录`, requestId: body.requestId };
      },
    },
  ];

  return cases;
}

// ─── 运行与报告 ───

export async function runSmokeTest(options: { verbose?: boolean }): Promise<SmokeReport> {
  const verbose = options.verbose ?? false;
  const report: SmokeReport = { lines: [], passed: 0, failed: 0, skipped: 0, totalLatencyMs: 0 };

  console.log(`\nAugustus Smoke Test — ${new Date().toISOString()}\n`);

  // 创建 test runtime + server（不监听端口）
  const testRuntime = createAugustusRuntime({ dataDir: ".augustus-test" });
  await testRuntime.start();

  const app = await createServer({ runtime: testRuntime, testRuntime, version: PKG_VERSION });

  const cases = defineCases(verbose);

  try {
    for (const c of cases) {
      const line = await c.run(app);
      const entry: SmokeLine = {
        method: c.method,
        route: c.route,
        label: c.label,
        ...line,
      };

      report.lines.push(entry);
      report.totalLatencyMs += entry.latencyMs;

      if (entry.result === "PASS") report.passed++;
      else if (entry.result === "FAIL") report.failed++;
      else report.skipped++;

      // 打印单行
      printLine(entry, verbose);
    }
  } finally {
    await app.close();
  }

  // 汇总
  console.log("");
  const total = report.passed + report.failed + report.skipped;
  const overall = report.failed === 0 ? "PASS" : "FAIL";
  console.log(
    `Total: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped  |  ${report.totalLatencyMs}ms`,
  );
  console.log(`Result: ${overall === "PASS" ? "PASS ✓" : "FAIL ✗"}`);
  console.log("");

  return report;
}

function printLine(entry: SmokeLine, verbose: boolean): void {
  const icon = entry.result === "PASS" ? "✓" : entry.result === "SKIP" ? "○" : "✗";
  const tag = entry.result === "PASS"
    ? "\x1b[32mPASS\x1b[0m"
    : entry.result === "SKIP"
      ? "\x1b[33mSKIP\x1b[0m"
      : "\x1b[31mFAIL\x1b[0m";

  const latency = entry.latencyMs > 0 ? `(${fmtLatency(entry.latencyMs)})` : "";
  const status = entry.statusCode > 0 ? `  ${fmtStatus(entry.statusCode)}` : "";
  const msg = entry.message ? `  ${entry.message}` : "";

  console.log(`  [${tag}] ${entry.method.padEnd(5)} ${entry.route.padEnd(24)} ${latency.padEnd(7)}${status}${msg}`);

  if (entry.result === "FAIL" && verbose && entry.detail) {
    console.log(`         detail: ${entry.detail.slice(0, 500)}`);
  }
  if (verbose && entry.detail && entry.result === "PASS") {
    console.log(`         detail: ${entry.detail.slice(0, 300)}`);
  }
}
