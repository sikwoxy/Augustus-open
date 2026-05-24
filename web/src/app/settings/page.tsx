"use client";

import { useState, useEffect } from "react";
import { Server, Loader2, Cpu, Search, Globe, FileText } from "lucide-react";
import { api } from "@/lib/api";
import type { StatusResponse } from "@/lib/api-types";
import { NavigationBar } from "@/components/navigation-bar";

interface ConfigInfo {
  provider: string;
  model: string;
  baseUrl: string;
  webSearchSupported: boolean;
  agentConfigs: Record<string, { provider: string; model: string }>;
  envFile: string;
}

const AGENT_LABELS: Record<string, { label: string; icon: typeof Cpu; desc: string }> = {
  main: { label: "主 Agent", icon: Cpu, desc: "对话入口，任务编排" },
  coder: { label: "Coder", icon: FileText, desc: "代码读写、shell、git" },
  researcher: { label: "Researcher", icon: Search, desc: "联网搜索、信息整合" },
  writer: { label: "Writer", icon: FileText, desc: "文档撰写、内容润色" },
};

function providerBadge(provider: string) {
  return provider === "anthropic"
    ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
    : "bg-green-500/10 text-green-400 border-green-500/30";
}

export default function SettingsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getStatus(),
      api.getConfig().catch(() => ({ ok: false as const, error: { message: "" } })),
    ]).then(([statusRes, configRes]) => {
      if (statusRes.ok) setStatus(statusRes.data);
      if (configRes.ok && configRes.data) setConfig(configRes.data as unknown as ConfigInfo);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-augustus-bg">
      <NavigationBar />
      <div className="fixed inset-0 bg-gradient-to-b from-augustus-bg via-augustus-bg-card to-augustus-bg pointer-events-none" />

      <div className="relative z-10 pt-24 pb-16 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="mb-12 text-center">
            <h1 className="text-xl tracking-[0.15em] text-augustus-text/80 font-light">系统配置</h1>
            <p className="text-xs text-augustus-accent/40 tracking-[0.2em] mt-1">System Configuration</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-augustus-text-dim py-12">
              <Loader2 className="w-3 h-3 animate-spin" />
              加载中...
            </div>
          ) : (
            <div className="space-y-6">
              {/* Runtime Status */}
              {status && (
                <Section title="Runtime 状态" icon={Server}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    {[
                      ["dataDir", status.dataDir],
                      ["sessions", String(status.sessionsLoaded)],
                      ["LLM", status.llmEnabled ? "已启用" : "未启用"],
                      ["uptime", `${Math.floor(status.uptimeMs / 3600000)}h ${Math.floor((status.uptimeMs % 3600000) / 60000)}m`],
                    ].map(([label, value]) => (
                      <div key={label} className="py-2 px-3 border border-augustus-accent/10 rounded-sm">
                        <span className="text-augustus-accent/40">{label}</span>
                        <span className="text-augustus-text/60 ml-1">{value}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* LLM Configuration */}
              {config && (
                <>
                  <Section title="LLM 通用配置" icon={Globe}>
                    <div className="space-y-2 text-xs">
                      <ConfigRow label="Provider" value={config.provider} mono />
                      <ConfigRow label="Model" value={config.model} mono />
                      <ConfigRow label="Base URL" value={config.baseUrl} mono />
                      <ConfigRow
                        label="Web Search"
                        value={
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${
                            config.webSearchSupported
                              ? "bg-green-500/10 text-green-400 border-green-500/30"
                              : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                          }`}>
                            {config.webSearchSupported ? "✅ 可用" : "⚠ 不可用"}
                          </span>
                        }
                      />
                      {!config.webSearchSupported && (
                        <p className="text-[11px] text-augustus-text-dim mt-1">
                          web_search 需要 Anthropic 协议
                        </p>
                      )}
                    </div>
                  </Section>

                  {/* Agent Configs */}
                  <Section title="各 Agent 配置" icon={Cpu}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Object.entries(config.agentConfigs).map(([key, cfg]) => {
                        const meta = AGENT_LABELS[key];
                        if (!meta) return null;
                        const Icon = meta.icon;
                        return (
                          <div key={key} className="border border-augustus-border rounded-sm p-3 bg-augustus-bg-input">
                            <div className="flex items-center gap-2 mb-2">
                              <Icon className="w-4 h-4 text-augustus-accent" />
                              <span className="text-sm text-augustus-text/80 font-medium">{meta.label}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${providerBadge(cfg.provider)}`}>
                                {cfg.provider}
                              </span>
                            </div>
                            <p className="text-[11px] text-augustus-text-dim mb-1">{meta.desc}</p>
                            <p className="text-xs font-mono text-augustus-text-muted">{cfg.model}</p>
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  {/* Configuration Guide */}
                  <Section title="配置指南" icon={FileText}>
                    <div className="space-y-4 text-xs">
                      <GuideBlock
                        title="切换 Anthropic（web_search 可用）"
                        code={`LLM_API_KEY=sk-ant-xxxx\nLLM_MODEL=claude-sonnet-4-6\nLLM_PROVIDER=anthropic`}
                      />
                      <GuideBlock
                        title="切换 DeepSeek（无 web_search）"
                        code={`LLM_API_KEY=sk-xxxx\nLLM_BASE_URL=https://api.deepseek.com\nLLM_MODEL=deepseek-v4-flash\nLLM_PROVIDER=openai`}
                      />
                      <GuideBlock
                        title="混合模式（主Agent用Claude，Coder用DeepSeek）"
                        code={`LLM_API_KEY=sk-ant-xxxx\nLLM_MODEL=claude-sonnet-4-6\nLLM_PROVIDER=anthropic\n\nAUGUSTUS_CODER_PROVIDER=openai\nAUGUSTUS_CODER_MODEL=deepseek-v4-pro\nAUGUSTUS_CODER_BASE_URL=https://api.deepseek.com\nAUGUSTUS_CODER_API_KEY=sk-ce0xxxx`}
                      />
                      {config.envFile && (
                        <div className="mt-3 p-3 border border-augustus-accent/10 rounded bg-augustus-accent-muted">
                          <p className="text-augustus-text-muted">
                            完整配置说明见 <code className="text-augustus-accent bg-augustus-bg-input px-1 rounded">{config.envFile}</code>
                          </p>
                        </div>
                      )}
                    </div>
                  </Section>
                </>
              )}

              {!config && !loading && (
                <div className="text-center py-8 text-xs text-augustus-text-dim">
                  无法获取配置信息，请检查后端是否运行
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared sub-components ───

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-augustus-border bg-augustus-bg-card rounded-md p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-sm border border-augustus-accent-ring bg-augustus-accent-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-augustus-accent" />
        </div>
        <h2 className="text-sm font-medium text-augustus-text/80 tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ConfigRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-augustus-text-dim">{label}</span>
      <span className={mono ? "font-mono text-augustus-text-muted" : "text-augustus-text-muted"}>
        {value}
      </span>
    </div>
  );
}

function GuideBlock({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <h4 className="text-augustus-accent font-semibold mb-1">{title}</h4>
      <pre className="bg-augustus-input border border-augustus-border rounded p-3 text-augustus-text-muted overflow-x-auto text-[11px]">
        {code}
      </pre>
    </div>
  );
}
