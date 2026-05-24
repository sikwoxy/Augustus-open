// ═══════════════════════════════════════════════
// Augustus CLI
// ═══════════════════════════════════════════════

import "dotenv/config";
import { createAugustusRuntime } from "@augustus/core";
import { startServer } from "./server";
import { startFeishuBot } from "./start-feishu";
import { runSmokeTest } from "./smoke-test";

const PKG_VERSION = "1.0.0";

function printHelp(): void {
  console.log(`
Augustus CLI v${PKG_VERSION}

Commands:
  serve   Start the Augustus HTTP server
  doctor  Check environment configuration
  smoke   Run smoke test against all API routes

Usage:
  npm run serve
  npm run doctor
  npm run smoke [--verbose]
`);
}

async function cmdServe(): Promise<void> {
  console.log("[augustus] Creating default runtime (.augustus/)...");
  const runtime = createAugustusRuntime();

  console.log("[augustus] Creating test runtime (.augustus-test/)...");
  const testRuntime = createAugustusRuntime({ dataDir: ".augustus-test" });

  console.log("[augustus] Starting runtimes...");
  await runtime.start();
  await testRuntime.start();

  // 飞书 Bot（需显式禁用才会跳过；默认配置了就启动）
  const feishuEnabled = process.env.AUGUSTUS_FEISHU_ENABLED !== "false";
  const feishuStopPromise = feishuEnabled
    ? startFeishuBot(runtime).catch((err) => {
        console.error("[augustus] Feishu bot error:", err);
        return () => {};
      })
    : (console.log("[augustus] Feishu disabled (AUGUSTUS_FEISHU_ENABLED=false)"), Promise.resolve(() => {}));

  // 统一优雅关闭：HTTP server（server.ts 的 once handler）关闭端口，这里关闭飞书 WS
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[augustus] Shutting down (${signal})...`);
    feishuStopPromise.then((feishuStop) => feishuStop());
    setTimeout(() => process.exit(0), 5_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("[augustus] Starting server...");
  await startServer({ runtime, testRuntime, version: PKG_VERSION });
}

async function cmdDoctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; message: string }> = [];

  // Node
  const major = parseInt(process.version.slice(1).split(".")[0], 10);
  checks.push({
    name: "Node.js",
    ok: major >= 18,
    message: `Node ${process.version} (>=18 required)`,
  });

  // dataDir
  const dataDir = process.env.AUGUSTUS_DATA_DIR ?? ".augustus";
  try {
    const fs = await import("fs/promises");
    await fs.access(dataDir);
    checks.push({ name: "dataDir", ok: true, message: `${dataDir} exists` });
  } catch {
    checks.push({ name: "dataDir", ok: false, message: `${dataDir} does not exist` });
  }

  // LLM
  const hasKey = !!process.env.LLM_API_KEY;
  const hasModel = !!process.env.LLM_MODEL;
  const hasProvider = !!process.env.LLM_PROVIDER;
  checks.push({
    name: "LLM",
    ok: hasKey && hasModel,
    message: [
      hasKey ? "API key: configured" : "LLM_API_KEY: missing",
      hasModel ? `Model: ${process.env.LLM_MODEL}` : "LLM_MODEL: missing",
      hasProvider ? `Provider: ${process.env.LLM_PROVIDER}` : "LLM_PROVIDER: not set",
    ].join(" | "),
  });

  // Feishu
  const feishuAppId = !!process.env.FEISHU_APP_ID;
  const feishuSecret = !!process.env.FEISHU_APP_SECRET;
  checks.push({
    name: "Feishu",
    ok: feishuAppId && feishuSecret,
    message: feishuAppId && feishuSecret
      ? "Feishu configured"
      : [feishuAppId ? "" : "FEISHU_APP_ID: missing", feishuSecret ? "" : "FEISHU_APP_SECRET: missing"]
          .filter(Boolean)
          .join(" | ") || "Feishu not configured (optional)",
  });

  // Server port
  checks.push({
    name: "Server Port",
    ok: true,
    message: `AUGUSTUS_SERVER_PORT=${process.env.AUGUSTUS_SERVER_PORT ?? "3000"}`,
  });

  console.log(`\nAugustus Doctor Report — ${new Date().toISOString()}\n`);
  for (const check of checks) {
    console.log(`  [${check.ok ? "OK" : "FAIL"}] ${check.name}: ${check.message}`);
  }

  const allOk = checks.every((c) => c.ok || c.name === "Feishu");
  console.log(`\nOverall: ${allOk ? "READY" : "HAS ISSUES"}\n`);

  if (!allOk) process.exitCode = 1;
}

// ─── Main ───

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "serve":
      await cmdServe();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "smoke": {
      const verbose = args.includes("--verbose") || args.includes("-v");
      const report = await runSmokeTest({ verbose });
      if (report.failed > 0) process.exitCode = 1;
      break;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[augustus] Fatal error:", err);
  process.exit(1);
});
