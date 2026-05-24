"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { testApi } from "@/lib/api";
import type { ChatResponse } from "@/lib/api-types";
import { FileCard } from "@/components/file-card";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

type TestStatus = "idle" | "running" | "success" | "failed" | "skipped";

interface TestResult {
  status: TestStatus;
  response?: ChatResponse;
  diagnostics?: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
  timestamp?: number;
}

interface PanelDef {
  id: string;
  icon: string;
  title: string;
  description: string;
  type: "api" | "chat" | "chat-multi";
  apiCalls?: (() => Promise<unknown>)[];
  chatPrompts?: string[];
  scenarioOptions?: { label: string; prompt: string }[];
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function getConvId(): string {
  if (typeof window === "undefined") return "test-conv";
  let id = sessionStorage.getItem("augustus_test_conv_id");
  if (!id) {
    id = "test_" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("augustus_test_conv_id", id);
  }
  return id;
}

function extractCodeBlocks(text: string): { code: string; language: string }[] {
  const blocks: { code: string; language: string }[] = [];
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ language: match[1] || "text", code: match[2].trim() });
  }
  return blocks;
}

function extractRunnableCode(text: string): string | null {
  const blocks = extractCodeBlocks(text);
  // 优先找 HTML 代码块
  for (const b of blocks) {
    if (b.language.toLowerCase() === "html" || b.code.includes("<!DOCTYPE") || b.code.includes("<html")) {
      return b.code;
    }
  }
  // 其次找包含完整 HTML 结构的代码块
  for (const b of blocks) {
    if (b.code.includes("<script") || (b.code.includes("<style") && b.code.includes("<body"))) {
      return b.code;
    }
  }
  // 回退：第一个代码块
  return blocks.length > 0 ? blocks[0].code : null;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(status: TestStatus): string {
  switch (status) {
    case "running": return "⏳";
    case "success": return "✅";
    case "failed": return "❌";
    case "skipped": return "⏭️";
    default: return "⬜";
  }
}

// ═══════════════════════════════════════════════
// Tiny Markdown Renderer (inline)
// ═══════════════════════════════════════════════

// 从 Agent 回复中提取子操作状态（✅/❌/⚠️）
function extractSubOps(text: string): Array<{ label: string; ok: boolean; detail?: string }> {
  const ops: Array<{ label: string; ok: boolean; detail?: string }> = [];
  // 匹配表格行：| 操作名 | ✅/❌ | 详情 |
  const tableRegex = /\|\s*(.+?)\s*\|\s*([✅❌⚠️])\s*\|?\s*(.*?)\s*\|/g;
  let match;
  while ((match = tableRegex.exec(text)) !== null) {
    const label = match[1].trim();
    const emoji = match[2];
    const detail = match[3]?.trim();
    if (label && !label.includes("---") && !label.includes("项目")) {
      ops.push({ label, ok: emoji === "✅", detail: detail || undefined });
    }
  }
  // 匹配列表项：✅ xxx  /  ❌ xxx
  if (ops.length === 0) {
    const itemRegex = /^-\s*([✅❌])\s+(.+)$/gm;
    while ((match = itemRegex.exec(text)) !== null) {
      ops.push({ label: match[2].trim(), ok: match[1] === "✅" });
    }
  }
  return ops;
}

function SubOpStatus({ text }: { text: string }) {
  const ops = extractSubOps(text);
  if (ops.length === 0) return null;
  return (
    <div className="bg-[#0A0A1A] border border-[#1A1A2E] rounded-lg p-3 space-y-1.5">
      <div className="text-[10px] text-[#707090] mb-1 uppercase tracking-wider">子操作状态</div>
      {ops.map((op, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={op.ok ? "text-green-400" : "text-red-400"}>{op.ok ? "✅" : "❌"}</span>
          <span className="text-[#C0C0D0]">{op.label}</span>
          {op.detail && <span className="text-[#707090] text-[11px]">— {op.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  // 转义 HTML
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // 简易渲染：代码块先分离
  const parts = escaped.split(/(```[\s\S]*?```)/g);
  return (
    <div className="prose prose-invert prose-sm max-w-none space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const inner = part.replace(/```\w*\n?/g, "").replace(/```$/g, "");
          return (
            <pre key={i} className="bg-[#0A0A1A] border border-[#2A2A4A] rounded p-3 overflow-x-auto text-xs text-[#A0A0C0]">
              {inner}
            </pre>
          );
        }
        // 加粗、标题、列表
        const html = part
          .replace(/^### (.+)$/gm, '<h4 class="text-[#E8C96A] text-sm font-semibold mt-3 mb-1">$1</h4>')
          .replace(/^## (.+)$/gm, '<h3 class="text-[#E8C96A] text-base font-semibold mt-3 mb-1">$1</h3>')
          .replace(/^# (.+)$/gm, '<h3 class="text-[#E8C96A] text-base font-semibold mt-3 mb-1">$1</h3>')
          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[#F5F0E8]">$1</strong>')
          .replace(/^- (.+)$/gm, '<li class="ml-4 text-[#C0C0D0]">$1</li>')
          .replace(/\n\n/g, '<br/><br/>');
        return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════

function ToolTimeline({ diagnostics }: { diagnostics?: Record<string, unknown> }) {
  if (!diagnostics) return null;
  const toolRounds = diagnostics.toolRounds as Array<{
    round: number;
    toolCalls?: Array<{ name: string; arguments?: string; result?: string; success?: boolean }>;
    finishReason?: string;
  }> | undefined;

  if (!toolRounds || toolRounds.length === 0) {
    return <p className="text-xs text-[#707090]">无工具调用记录</p>;
  }

  return (
    <div className="space-y-2">
      {toolRounds.map((round, idx) => (
        <div key={round.round ?? idx} className="border-l-2 border-[#2A2A4A] pl-3 py-1">
          <div className="text-xs text-[#E8C96A] font-semibold mb-1">
            第 {round.round ?? idx + 1} 轮 {round.finishReason === "final" ? "· 最终回复" : ""}
          </div>
          {round.toolCalls?.map((call, i) => (
            <div key={`${round.round ?? idx}-${call.name}-${i}`} className="flex items-center gap-2 text-xs mb-0.5">
              <span className={`w-2 h-2 rounded-full ${call.success !== false ? "bg-green-500" : "bg-red-500"}`} />
              <code className="text-[#C9A84C] bg-[#1A1A2E] px-1 rounded">{call.name}</code>
              {call.arguments && (
                <span className="text-[#707090] truncate max-w-[300px]">
                  {call.arguments.slice(0, 100)}
                </span>
              )}
            </div>
          ))}
          {!round.toolCalls && (
            <span className="text-xs text-[#707090]">（文本回复）</span>
          )}
        </div>
      ))}
    </div>
  );
}

function CodeSandbox({
  code,
  replyFiles,
  getFileUrl,
}: {
  code: string | null;
  replyFiles?: Array<{ fileName: string; localPath: string; size: number }>;
  getFileUrl?: (fileName: string) => string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const htmlFile = !code && replyFiles?.find((f) => /\.html?$/i.test(f.fileName));
  const effectiveCode = code || fetchedCode;

  // 从 replyFiles 中没有可用代码时
  if (!code && !htmlFile) {
    return <p className="text-sm text-[#707090]">未提取到可运行代码</p>;
  }

  // 有 replyFile 但还没 fetch 时显示按钮
  if (!effectiveCode && htmlFile && getFileUrl) {
    const loadFile = async () => {
      setFetching(true);
      try {
        const res = await fetch(getFileUrl(htmlFile.fileName), {
          headers: { "x-augustus-test-mode": "true" },
        });
        if (res.ok) {
          const text = await res.text();
          setFetchedCode(text);
        }
      } catch {
        // ignore fetch errors
      } finally {
        setFetching(false);
      }
    };

    return (
      <div className="space-y-2">
        <p className="text-sm text-[#C0C0D0]">📎 生成文件：<span className="text-[#E8C96A]">{htmlFile.fileName}</span></p>
        <button
          onClick={loadFile}
          disabled={fetching}
          className="px-3 py-1.5 text-xs bg-[#C9A84C] text-[#0A0A1A] rounded hover:bg-[#E8C96A] transition-colors font-semibold disabled:opacity-50"
        >
          {fetching ? "⏳ 加载中..." : "▶ 加载并预览"}
        </button>
      </div>
    );
  }

  if (!effectiveCode) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="px-3 py-1.5 text-xs bg-[#C9A84C] text-[#0A0A1A] rounded hover:bg-[#E8C96A] transition-colors font-semibold"
        >
          {showPreview ? "隐藏预览" : "▶ 预览效果"}
        </button>
        <span className="text-xs text-[#707090] self-center">
          代码 {effectiveCode.length} 字符 {htmlFile ? `(来自 ${htmlFile.fileName})` : ""}
        </span>
      </div>

      {showPreview && (
        <div className="border border-[#2A2A4A] rounded-lg overflow-hidden">
          <div className="bg-[#1A1A2E] px-3 py-1.5 text-xs text-[#707090] border-b border-[#2A2A4A] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="ml-2">Sandbox Preview</span>
          </div>
          <iframe
            sandbox="allow-scripts"
            srcDoc={effectiveCode}
            className="w-full bg-white"
            style={{ minHeight: "500px", height: "60vh", border: "none" }}
            title="Code Preview"
          />
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-[#707090] hover:text-[#C0C0D0]">
          查看源代码
        </summary>
        <pre className="bg-[#0A0A1A] border border-[#2A2A4A] rounded p-3 overflow-x-auto mt-2 text-[#A0A0C0] max-h-[400px] overflow-y-auto">
          {effectiveCode}
        </pre>
      </details>
    </div>
  );
}

function CapabilityScorecard({ results }: { results: Record<string, TestResult> }) {
  const dimensions = [
    { key: "health", label: "系统连通性", icon: "🔌" },
    { key: "chat", label: "基础对话", icon: "💬" },
    { key: "task", label: "任务编排", icon: "📋" },
    { key: "coder-code", label: "Coder 代码实现", icon: "⚡" },
    { key: "coder-ops", label: "Coder 项目操作", icon: "🔧" },
    { key: "researcher", label: "Researcher 搜索", icon: "🔍" },
    { key: "memory", label: "记忆系统", icon: "🧠" },
    { key: "streaming", label: "流式输出", icon: "📡" },
  ];

  const getScore = (key: string): number => {
    const r = results[key];
    if (!r || r.status === "idle") return 0;
    if (r.status === "success") return 5;
    if (r.status === "failed") return 1;
    return 3;
  };

  const getNote = (key: string): string => {
    const r = results[key];
    if (key === "streaming") return "未实现 (架构 gap)";
    if (!r || r.status === "idle") return "未测试";
    if (r.status === "success") return r.latencyMs ? `通过 (${formatLatency(r.latencyMs)})` : "通过";
    if (r.status === "failed") return r.error ? `失败: ${r.error.slice(0, 40)}` : "失败";
    return "—";
  };

  const totalScore = dimensions.reduce((sum, d) => {
    const s = getScore(d.key);
    return sum + (d.key === "streaming" ? 0 : s); // streaming 不计入总分
  }, 0);
  const maxScore = (dimensions.length - 1) * 5;

  return (
    <div className="bg-[#0F0A1E] border border-[#2A2A4A] rounded-xl p-6">
      <h2 className="text-lg font-semibold text-[#E8C96A] mb-4">📊 能力评分卡</h2>
      <div className="text-2xl font-bold text-[#F5F0E8] mb-4">
        {totalScore} / {maxScore}
        <span className="text-sm text-[#707090] ml-2">
          ({Math.round((totalScore / maxScore) * 100)}%)
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {dimensions.map((d) => {
          const score = getScore(d.key);
          return (
            <div key={d.key} className="bg-[#0A0A1A] rounded-lg p-3 border border-[#1A1A2E]">
              <div className="text-lg mb-1">{d.icon}</div>
              <div className="text-xs text-[#C0C0D0] font-semibold mb-1">{d.label}</div>
              <div className="flex gap-0.5 mb-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star} className={`text-xs ${star <= score ? "text-[#E8C96A]" : "text-[#2A2A4A]"}`}>
                    ★
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-[#707090]">{getNote(d.key)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Test Panel Component
// ═══════════════════════════════════════════════

function TestPanel({
  panel,
  result,
  onRun,
  onContinue,
  isOpen,
  onToggle,
}: {
  panel: PanelDef;
  result: TestResult;
  onRun: (panel: PanelDef, effectivePrompt?: string) => void;
  onContinue?: (panel: PanelDef, confirmMessage: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [step, setStep] = useState<"request" | "confirming" | "done">("request");
  const selectedPrompt = panel.scenarioOptions
    ? panel.scenarioOptions[scenarioIndex].prompt
    : panel.chatPrompts?.[0] || "";

  // Detect if response needs confirmation (checkpoint created, waiting for user)
  const needsConfirmation = useCallback((result: TestResult): boolean => {
    if (result.status !== "success" || !result.response?.text) return false;
    const text = result.response.text;
    // Check for confirmation patterns in response text
    const confirmPatterns = [
      "同意", "确认", "请确认", "是否继续", "开始生成",
      "计划如下", "方案如下",
      "请问同意", "可以开始",
    ];
    const hasConfirmPattern = confirmPatterns.some((p) => text.includes(p));
    // Also check if create_implementation_checkpoint was called
    const diag = result.diagnostics;
    const hasCheckpointTool = !!diag && JSON.stringify(diag).includes("create_implementation_checkpoint");
    // Check if code is already present (no confirmation needed)
    const hasCode = extractRunnableCode(text) !== null;
    return hasConfirmPattern && hasCheckpointTool && !hasCode;
  }, []);

  // Reset step when panel is re-run
  const handleRun = (p: PanelDef, prompt?: string) => {
    setStep("request");
    onRun(p, prompt);
  };

  // When result updates, check if we need to move to confirming step
  useEffect(() => {
    if (result.status !== "success") return;
    if (step === "request" && needsConfirmation(result)) {
      setStep("confirming");
    } else if (step === "confirming" && !needsConfirmation(result)) {
      setStep("done");
    } else if (step === "request" && !needsConfirmation(result)) {
      // Code generated directly without checkpoint
      setStep("done");
    }
  }, [result, step, needsConfirmation]);

  return (
    <div className="bg-[#0F0A1E] border border-[#2A2A4A] rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#1A1A2E]/50 transition-colors"
      >
        <span className="text-xl">{panel.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[#F5F0E8] font-semibold">{panel.title}</span>
            <span className="text-lg">{statusIcon(result.status)}</span>
          </div>
          <p className="text-xs text-[#707090] truncate">{panel.description}</p>
        </div>
        <span className="text-[#707090] text-sm">{isOpen ? "▲" : "▼"}</span>
      </button>

      {/* Body */}
      {isOpen && (
        <div className="px-5 pb-5 space-y-4 border-t border-[#1A1A2E] pt-4">
          {/* Test prompt / scenario selector */}
          {panel.type === "chat" && panel.scenarioOptions && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#707090]">场景：</label>
              <select
                value={scenarioIndex}
                onChange={(e) => setScenarioIndex(Number(e.target.value))}
                className="bg-[#0A0A1A] border border-[#2A2A4A] rounded px-2 py-1 text-xs text-[#C0C0D0]"
              >
                {panel.scenarioOptions.map((opt, i) => (
                  <option key={i} value={i}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Test instruction */}
          {panel.type === "chat" && (
            <div className="bg-[#0A0A1A] border border-[#1A1A2E] rounded-lg p-3">
              <div className="text-[10px] text-[#707090] mb-1 uppercase tracking-wider">测试指令</div>
              <p className="text-sm text-[#C0C0D0]">{selectedPrompt}</p>
            </div>
          )}

          {panel.type === "chat-multi" && panel.chatPrompts && (
            <div className="bg-[#0A0A1A] border border-[#1A1A2E] rounded-lg p-3 space-y-2">
              <div className="text-[10px] text-[#707090] mb-1 uppercase tracking-wider">多轮对话测试</div>
              {panel.chatPrompts.map((p, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-[10px] text-[#C9A84C] mt-0.5">第{i + 1}轮</span>
                  <p className="text-sm text-[#C0C0D0]">{p}</p>
                </div>
              ))}
            </div>
          )}

          {/* Run button */}
          <div className="flex gap-2">
            <button
              onClick={() => handleRun(panel, selectedPrompt)}
              disabled={result.status === "running"}
              className={`px-4 py-2 text-sm rounded-lg font-semibold transition-all ${
                result.status === "running"
                  ? "bg-[#1A1A2E] text-[#707090] cursor-wait"
                  : "bg-[#C9A84C] text-[#0A0A1A] hover:bg-[#E8C96A]"
              }`}
            >
              {result.status === "running" ? "⏳ 执行中..." : step === "done" ? "🔄 重新测试" : "▶ 执行测试"}
            </button>

            {/* Confirmation button for coder-code panel */}
            {panel.id === "coder-code" && step === "confirming" && onContinue && (
              <button
                onClick={() => {
                  setStep("request"); // reset for next turn
                  onContinue(panel, "同意，请开始生成代码");
                }}
                className="px-4 py-2 text-sm rounded-lg font-semibold bg-green-600 text-white hover:bg-green-500 transition-all animate-pulse"
              >
                ✅ 确认并继续生成
              </button>
            )}
          </div>

          {/* Step indicator for multi-step panels */}
          {panel.id === "coder-code" && step === "confirming" && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center gap-3">
              <span className="text-lg">⏸️</span>
              <div>
                <p className="text-sm text-yellow-400 font-semibold">等待用户确认</p>
                <p className="text-xs text-[#A0A0C0]">
                  主 Agent 已生成实施方案（Implementation Checkpoint），请点击「确认并继续生成」按钮推进
                </p>
              </div>
            </div>
          )}

          {/* Result */}
          {result.status !== "idle" && (
            <div className="space-y-3">
              {/* Error */}
              {result.error && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                  <p className="text-sm text-red-400">{result.error}</p>
                </div>
              )}

              {/* Sub-operation status for delegation panels */}
              {panel.id === "coder-ops" && result.response?.text && (
                <SubOpStatus text={result.response.text} />
              )}

              {/* Response text */}
              {result.response?.text && (
                <div className="bg-[#0A0A1A] border border-[#1A1A2E] rounded-lg p-4">
                  <div className="text-[10px] text-[#707090] mb-2 uppercase tracking-wider">
                    {step === "confirming" ? "📋 方案 (待确认)" : "回复"} {result.latencyMs ? `· ${formatLatency(result.latencyMs)}` : ""}
                    {result.response.usage ? ` · ${result.response.usage.totalTokens} tokens` : ""}
                  </div>
                  <SimpleMarkdown text={result.response.text} />
                </div>
              )}

              {/* Reply files (from send_file tool) */}
              {result.response?.replyFiles && result.response.replyFiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-[#707090] uppercase tracking-wider">📎 已发送文件</div>
                  {result.response.replyFiles.map((f, j) => (
                    <FileCard
                      key={j}
                      file={f}
                      downloadUrl={testApi.getFileUrl(f.fileName, "test-conv", "web")}
                    />
                  ))}
                </div>
              )}

              {/* Code preview for coder-code panel */}
              {panel.id === "coder-code" && step === "done" && (
                <CodeSandbox
                  code={extractRunnableCode(result.response?.text || "")}
                  replyFiles={result.response?.replyFiles}
                  getFileUrl={(name: string) => testApi.getFileUrl(name, "test-conv", "web")}
                />
              )}

              {/* Diagnostics / Tool Timeline */}
              {result.diagnostics && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[#707090] hover:text-[#C0C0D0] py-1">
                    🔍 诊断信息 & 工具调用链
                  </summary>
                  <div className="mt-3 space-y-4">
                    <ToolTimeline diagnostics={result.diagnostics} />

                    {/* System prompt preview */}
                    {typeof result.diagnostics.systemPrompt === "string" && (
                      <details>
                        <summary className="cursor-pointer text-[#707090] hover:text-[#C0C0D0]">
                          📝 System Prompt ({result.diagnostics.systemPrompt.length} 字符)
                        </summary>
                        <pre className="bg-[#0A0A1A] border border-[#2A2A4A] rounded p-3 overflow-x-auto mt-2 text-[#A0A0C0] max-h-[300px] overflow-y-auto text-[11px] leading-relaxed whitespace-pre-wrap">
                          {result.diagnostics.systemPrompt}
                        </pre>
                      </details>
                    )}

                    {/* Raw diagnostics JSON */}
                    <details>
                      <summary className="cursor-pointer text-[#707090] hover:text-[#C0C0D0]">
                        🔧 完整诊断 JSON
                      </summary>
                      <pre className="bg-[#0A0A1A] border border-[#2A2A4A] rounded p-3 overflow-x-auto mt-2 text-[#A0A0C0] max-h-[400px] overflow-y-auto text-[11px]">
                        {JSON.stringify(result.diagnostics, null, 2)}
                      </pre>
                    </details>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Panel Definitions
// ═══════════════════════════════════════════════

const CODER_CODE_SCENARIOS = [
  {
    label: "科学计算器",
    prompt: "帮我写一个带加减乘除的科学计算器，纯HTML/CSS/JS单文件，要美观，按钮布局清晰，能直接用浏览器打开",
  },
  {
    label: "待办事项列表",
    prompt: "帮我写一个待办事项列表(Todo List)，可以添加新事项、勾选完成（划线+变灰）、删除事项，纯HTML/CSS/JS单文件，界面简洁现代",
  },
  {
    label: "Canvas 粒子动画",
    prompt: "帮我写一个Canvas粒子动画效果，鼠标移动时粒子跟随，点击时粒子爆炸散开，纯HTML单文件，视觉效果酷炫",
  },
];

const PANELS: PanelDef[] = [
  // ─── 1. 系统连通性 ───
  {
    id: "health",
    icon: "🔌",
    title: "系统连通性",
    description: "验证 backend 8 个 API 端点是否全部可达",
    type: "api",
    apiCalls: [
      () => testApi.health(),
      () => testApi.ready(),
      () => testApi.getStatus(),
      () => testApi.getTasks(),
    ],
  },

  // ─── 2. 基础对话 ───
  {
    id: "chat",
    icon: "💬",
    title: "基础对话 & 上下文记忆",
    description: "验证 LLM 回复质量及多轮对话上下文保持能力",
    type: "chat-multi",
    chatPrompts: [
      "你好，请用一句话介绍你自己叫什么名字",
      "我刚才问了你什么？请重复一下我的问题",
    ],
  },

  // ─── 3. 任务编排 ───
  {
    id: "task",
    icon: "📋",
    title: "任务编排能力",
    description: "验证任务创建 → 查看 → 完成的完整生命周期",
    type: "chat-multi",
    chatPrompts: [
      "帮我创建一个新任务，标题是「能力测试」，目标是系统性地验证 Augustus 核心功能是否正常工作",
      "列出我当前的所有任务",
      "完成当前任务，用一句话总结测试结果",
    ],
  },

  // ─── 4. Coder 代码实现 ───
  {
    id: "coder-code",
    icon: "⚡",
    title: "Coder 代码实现 (核心考察)",
    description: "委托 Coder 子Agent 编写一个完整的交互式应用，并在页面中直接预览效果。考察委托链路的完整性",
    type: "chat",
    scenarioOptions: CODER_CODE_SCENARIOS,
    chatPrompts: [CODER_CODE_SCENARIOS[0].prompt],
  },

  // ─── 5. Coder 项目操作 ───
  {
    id: "coder-ops",
    icon: "🔧",
    title: "Coder 项目操作",
    description: "验证 Coder 子Agent 能否正确读取项目文件和执行 git 操作",
    type: "chat",
    chatPrompts: ["帮我读取 CLAUDE.md 文件的内容，然后查看当前项目的 git 状态"],
  },

  // ─── 6. Researcher 搜索 ───
  {
    id: "researcher",
    icon: "🔍",
    title: "Researcher 联网搜索",
    description: "验证主Agent能否将搜索任务委托给 Researcher 子Agent",
    type: "chat",
    chatPrompts: ["帮我联网搜索一下 TypeScript 5 有哪些重要的新特性，列出关键点"],
  },

  // ─── 7. 记忆系统 ───
  {
    id: "memory",
    icon: "🧠",
    title: "记忆系统",
    description: "创建记忆候选 → 触发 sleep 整合 → 验证记忆持久化",
    type: "chat",
    chatPrompts: ["请记住这条信息：Augustus 能力测试已于 2026 年 5 月 16 日完成，所有核心功能验证通过"],
  },
];

// ═══════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════

export default function TestPage() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [autoRunDone, setAutoRunDone] = useState(false);
  const convIdRef = useRef(getConvId());

  // Active task tracking — 防止多个测试面板共享同一个任务上下文
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskPanel, setActiveTaskPanel] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState(false);
  const activeTaskRef = useRef<{ taskId: string; panelId: string } | null>(null);

  function syncActiveTask(taskId: string | null, panelId: string | null) {
    setActiveTaskId(taskId);
    setActiveTaskPanel(panelId);
    activeTaskRef.current = taskId && panelId ? { taskId, panelId } : null;
  }

  // 完成当前活跃任务
  const completeActiveTask = useCallback(async () => {
    const current = activeTaskRef.current;
    if (!current) return;
    setCompletingTask(true);
    try {
      const res = await testApi.chat({
        conversationId: convIdRef.current,
        text: "完成当前任务，用一句话总结结果。",
        channel: "web",
        userId: "local-user",
      });
      if (res.ok) {
        setResults((prev) => ({
          ...prev,
          [current.panelId]: {
            ...prev[current.panelId],
            response: res.data!,
            diagnostics: res.data?.diagnostics,
          },
        }));
      }
    } catch {
      // 忽略完成失败
    } finally {
      syncActiveTask(null, null);
      setCompletingTask(false);
    }
  }, []);

  // Auto-run health check on mount
  useEffect(() => {
    async function autoHealth() {
      try {
        const res = await testApi.health();
        setBackendOnline(res.ok);
      } catch {
        setBackendOnline(false);
      }
      // Auto-run panel 1
      runPanel(PANELS[0]);
      setAutoRunDone(true);
    }
    autoHealth();
  }, []);

  const runPanel = useCallback(async (panel: PanelDef) => {
    setResults((prev) => ({ ...prev, [panel.id]: { status: "running" } }));
    setOpenPanels((prev) => ({ ...prev, [panel.id]: true }));

    const startedAt = Date.now();

    try {
      if (panel.type === "api" && panel.apiCalls) {
        // ─── Direct API calls ───
        const callResults: unknown[] = [];
        for (const call of panel.apiCalls!) {
          callResults.push(await call());
        }
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            diagnostics: { apiResults: callResults },
            latencyMs,
            timestamp: Date.now(),
          },
        }));
      } else if (panel.type === "chat-multi" && panel.chatPrompts) {
        // ─── Multi-turn chat ───
        const convId = convIdRef.current;
        const responses: ChatResponse[] = [];
        for (const prompt of panel.chatPrompts) {
          const res = await testApi.chat({
            conversationId: convId,
            text: prompt,
            channel: "web",
            userId: "local-user",
          });
          if (!res.ok) throw new Error(res.error?.message || "Chat API error");
          responses.push(res.data!);
        }
        const lastResp = responses[responses.length - 1];
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            response: lastResp,
            diagnostics: {
              ...lastResp.diagnostics,
              multiTurnCount: responses.length,
            },
            latencyMs,
            timestamp: Date.now(),
          },
        }));
      } else if (panel.type === "chat") {
        // ─── Single-turn chat ───
        const prompt = panel.scenarioOptions
          ? panel.scenarioOptions[0].prompt // will be overridden by panel state, handled in TestPanel
          : panel.chatPrompts![0];

        const res = await testApi.chat({
          conversationId: convIdRef.current,
          text: prompt,
          channel: "web",
          userId: "local-user",
        });
        if (!res.ok) throw new Error(res.error?.message || "Chat API error");
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            response: res.data!,
            diagnostics: res.data?.diagnostics,
            latencyMs,
            timestamp: Date.now(),
          },
        }));
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      setResults((prev) => ({
        ...prev,
        [panel.id]: {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
          timestamp: Date.now(),
        },
      }));
    }
  }, []);

  // Handle run from TestPanel (which may have scenario override)
  const handleRun = useCallback(async (panel: PanelDef, effectivePrompt?: string) => {
    // 如果不是 API 面板，且存在其他面板创建的活跃任务，阻止执行
    if (panel.type !== "api" && activeTaskRef.current && activeTaskRef.current.panelId !== panel.id) {
      alert(`当前有活跃任务 (${activeTaskRef.current.taskId.slice(-8)})，请先点击「完成当前任务」再进行下一项测试。`);
      return;
    }
    setResults((prev) => ({ ...prev, [panel.id]: { status: "running" } }));
    setOpenPanels((prev) => ({ ...prev, [panel.id]: true }));

    const startedAt = Date.now();

    try {
      if (panel.type === "api" && panel.apiCalls) {
        const callResults: unknown[] = [];
        for (const call of panel.apiCalls!) {
          callResults.push(await call());
        }
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            diagnostics: { apiResults: callResults },
            latencyMs,
            timestamp: Date.now(),
          },
        }));
      } else if (panel.type === "chat-multi" && panel.chatPrompts) {
        const convId = convIdRef.current;
        const responses: ChatResponse[] = [];
        for (const prompt of panel.chatPrompts) {
          const res = await testApi.chat({
            conversationId: convId,
            text: prompt,
            channel: "web",
            userId: "local-user",
          });
          if (!res.ok) throw new Error(res.error?.message || "Chat API error");
          responses.push(res.data!);
        }
        const lastResp = responses[responses.length - 1];
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            response: lastResp,
            diagnostics: {
              ...lastResp.diagnostics,
              multiTurnCount: responses.length,
            },
            latencyMs,
            timestamp: Date.now(),
          },
        }));
        // 捕获多轮对话后的目标任务状态
        if (lastResp?.taskStatus === "active" && lastResp?.taskId) {
          syncActiveTask(lastResp.taskId, panel.id);
        } else {
          syncActiveTask(null, null);
        }
      } else if (panel.type === "chat") {
        const prompt = effectivePrompt || panel.chatPrompts?.[0] || "";
        const res = await testApi.chat({
          conversationId: convIdRef.current,
          text: prompt,
          channel: "web",
          userId: "local-user",
        });
        if (!res.ok) throw new Error(res.error?.message || "Chat API error");
        const latencyMs = Date.now() - startedAt;
        setResults((prev) => ({
          ...prev,
          [panel.id]: {
            status: "success",
            response: res.data!,
            diagnostics: res.data?.diagnostics,
            latencyMs,
            timestamp: Date.now(),
          },
        }));
        // 捕获单轮对话后的目标任务状态
        if (res.data?.taskStatus === "active" && res.data?.taskId) {
          syncActiveTask(res.data.taskId, panel.id);
        } else {
          syncActiveTask(null, null);
        }
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      setResults((prev) => ({
        ...prev,
        [panel.id]: {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
          timestamp: Date.now(),
        },
      }));
    }
  }, []);

  // Also trigger sleep API for memory panel
  const handleMemoryRun = useCallback(async (panel: PanelDef, effectivePrompt?: string) => {
    await handleRun(panel, effectivePrompt);
    try {
      await testApi.sleep();
    } catch {
      // Sleep may fail gracefully
    }
  }, [handleRun]);

  // Handle continue (confirmation follow-up) for multi-step panels like coder-code
  const handleContinue = useCallback(async (panel: PanelDef, confirmMessage: string) => {
    setResults((prev) => ({ ...prev, [panel.id]: { status: "running" } }));

    const startedAt = Date.now();
    try {
      const res = await testApi.chat({
        conversationId: convIdRef.current,
        text: confirmMessage,
        channel: "web",
        userId: "local-user",
      });
      if (!res.ok) throw new Error(res.error?.message || "Chat API error");
      const latencyMs = Date.now() - startedAt;
      setResults((prev) => ({
        ...prev,
        [panel.id]: {
          status: "success",
          response: res.data!,
          diagnostics: res.data?.diagnostics,
          latencyMs,
          timestamp: Date.now(),
        },
      }));
      // 捕获确认后续轮次的任务状态
      if (res.data?.taskStatus === "active" && res.data?.taskId) {
        syncActiveTask(res.data.taskId, panel.id);
      } else {
        syncActiveTask(null, null);
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      setResults((prev) => ({
        ...prev,
        [panel.id]: {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
          timestamp: Date.now(),
        },
      }));
    }
  }, []);

  const togglePanel = useCallback((id: string) => {
    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Reset handler
  const [resetState, setResetState] = useState<string | null>(null);
  const handleReset = async () => {
    if (!confirm("确认重置测试环境？\n\n将清理 .augustus-test/ 下所有数据（tasks、sessions、agent-runs、memory、files 等），不可恢复。")) return;
    setResetState("resetting");
    try {
      const res = await testApi.reset();
      if (res.ok) {
        setResetState(`已清理 ${res.data!.deleted.length} 个目录`);
        // 重置页面状态
        setResults({});
        setOpenPanels({});
        setSleepResult(null);
        syncActiveTask(null, null);
        // 生成新的会话ID
        convIdRef.current = "test_" + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem("augustus_test_conv_id", convIdRef.current);
        // 重新运行健康检查
        setTimeout(() => {
          setBackendOnline(null);
          testApi.health().then((r) => setBackendOnline(r.ok)).catch(() => setBackendOnline(false));
          runPanel(PANELS[0]);
        }, 500);
      } else {
        setResetState("失败");
      }
    } catch {
      setResetState("网络错误");
    }
  };

  // Sleep trigger (standalone)
  const [sleepResult, setSleepResult] = useState<string | null>(null);
  const triggerSleep = async () => {
    setSleepResult("running");
    try {
      const res = await testApi.sleep();
      setSleepResult(res.ok ? `已整合 · dateKey: ${res.data?.dateKey || "?"}` : "失败");
    } catch {
      setSleepResult("失败");
    }
  };

  const passed = Object.values(results).filter((r) => r.status === "success").length;
  const failed = Object.values(results).filter((r) => r.status === "failed").length;
  const total = Object.values(results).filter((r) => r.status !== "idle").length;

  return (
    <div className="min-h-screen bg-[#0A0A1A] text-[#F5F0E8]">
      {/* Header */}
      <header className="border-b border-[#1A1A2E] bg-[#0A0A1A]/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E8C96A]">Augustus 能力测试中心</h1>
            <p className="text-xs text-[#707090]">Capability Test Center · 验证 Agent 核心能力，识别待补齐短板</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Backend status */}
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  backendOnline === null ? "bg-gray-500" : backendOnline ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-[#707090]">
                {backendOnline === null ? "检测中..." : backendOnline ? "Backend 已连接" : "Backend 离线"}
              </span>
            </div>
            {/* Active task indicator */}
            {activeTaskId && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-400">活跃任务</span>
                <code className="text-[#707090] bg-[#1A1A2E] px-1 rounded">{activeTaskId.slice(-8)}</code>
                {activeTaskPanel && (
                  <span className="text-[#707090]">({PANELS.find(p => p.id === activeTaskPanel)?.title || activeTaskPanel})</span>
                )}
                <button
                  onClick={completeActiveTask}
                  disabled={completingTask}
                  className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                >
                  {completingTask ? "⏳" : "✓"} 完成任务
                </button>
              </div>
            )}
            {/* Test stats */}
            {autoRunDone && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-green-400">{passed} 通过</span>
                {failed > 0 && <span className="text-red-400">{failed} 失败</span>}
                <span className="text-[#707090]">/ {total} 项</span>
              </div>
            )}
            {/* Reset button */}
            <button
              onClick={handleReset}
              disabled={resetState === "resetting"}
              className="px-3 py-1 text-xs bg-red-500/10 border border-red-500/30 text-red-400 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {resetState === "resetting" ? "⏳" : "🧹"} {resetState && resetState !== "resetting" ? resetState : "重置环境"}
            </button>
            <a href="/chat" className="text-xs text-[#C9A84C] hover:text-[#E8C96A] transition-colors">
              返回 Chat →
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        {/* Panels */}
        {PANELS.map((panel) => (
          <TestPanel
            key={panel.id}
            panel={panel}
            result={results[panel.id] || { status: "idle" }}
            onRun={panel.id === "memory" ? handleMemoryRun : handleRun}
            onContinue={panel.id === "coder-code" ? handleContinue : undefined}
            isOpen={openPanels[panel.id] ?? false}
            onToggle={() => togglePanel(panel.id)}
          />
        ))}

        {/* Memory: standalone sleep trigger */}
        <div className="bg-[#0F0A1E] border border-[#1A1A2E] rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-sm text-[#C0C0D0] font-semibold">🧠 手动触发记忆整合 (Sleep)</span>
            <p className="text-xs text-[#707090] mt-0.5">处理当日原始事件 → 生成摘要/剧集 → 候选项转原子 → 停用过期记忆</p>
          </div>
          <div className="flex items-center gap-3">
            {sleepResult && sleepResult !== "running" && (
              <span className="text-xs text-[#A0A0C0]">{sleepResult}</span>
            )}
            <button
              onClick={triggerSleep}
              disabled={sleepResult === "running"}
              className="px-3 py-1.5 text-xs bg-[#2A2A4A] text-[#C0C0D0] rounded hover:bg-[#3A3A5A] transition-colors"
            >
              {sleepResult === "running" ? "⏳" : "POST /v1/sleep"}
            </button>
          </div>
        </div>

        {/* Scorecard */}
        <CapabilityScorecard results={results} />

        {/* Footer: known gaps */}
        <div className="bg-[#0F0A1E] border border-[#2A2A4A] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#E8C96A] mb-3">📋 已知待补齐项 (基于源码分析)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { item: "流式输出 (SSE)", status: "未实现", desc: "Loop 层无流式支持，chat API 完全阻塞", priority: "高" },
              { item: "Skills 目录", status: "空", desc: "加载器完整，但 skills/ 目录不存在", priority: "中" },
              { item: "Model Router", status: "未实现", desc: "无按任务类型/成本的模型选择", priority: "中" },
              { item: "自动 Sleep 调度", status: "手动", desc: "需人工调用 POST /v1/sleep", priority: "中" },
              { item: "环境先验 → 主Agent", status: "未注入", desc: "仅子Agent 获取环境信息，主Agent 不知宿主能力", priority: "低" },
              { item: "并行工具执行", status: "顺序", desc: "Loop.executeToolCalls 用 for 循环顺序执行", priority: "低" },
              { item: "Smoke Test", status: "缺失", desc: "无自动化验证，每次改动靠人工", priority: "高" },
              { item: "Web API 联调", status: "已完成", desc: "前端已全部直连后端，不再依赖 mock", priority: "已完成" },
            ].map((gap) => (
              <div key={gap.item} className="flex items-start gap-3 bg-[#0A0A1A] rounded-lg p-3 border border-[#1A1A2E]">
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold mt-0.5 ${
                  gap.priority === "高" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
                }`}>
                  {gap.priority}
                </span>
                <div>
                  <div className="text-sm text-[#C0C0D0] font-semibold">{gap.item}</div>
                  <div className="text-xs text-[#707090]">{gap.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
