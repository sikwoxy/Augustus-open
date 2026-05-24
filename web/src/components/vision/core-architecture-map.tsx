import {
  Archive,
  Bot,
  Brain,
  Braces,
  Cable,
  CheckCircle2,
  CircleDot,
  Database,
  FileOutput,
  MessageSquareText,
  Network,
  Sparkles,
  Wrench,
} from "lucide-react"
import type { ElementType, ReactNode } from "react"

type NodeProps = {
  title: string
  subtitle?: string
  icon: ElementType
  className?: string
  compact?: boolean
}

const mobileFlow = [
  { title: "用户自然表达", subtitle: "消息 / 文件 / 目标", icon: MessageSquareText },
  { title: "渠道入口", subtitle: "Web / 飞书 / CLI / API", icon: Cable },
  { title: "HTTP 适配层", subtitle: "统一响应 + requestId", icon: Network },
  { title: "Augustus Runtime", subtitle: "receive / sleep / status / tasks", icon: Braces },
  { title: "上下文装配", subtitle: "Task + Session + Memory Wake", icon: Brain },
  { title: "主 Agent 循环", subtitle: "判断任务、tool-call、委托子 Agent", icon: Bot },
  { title: "行动与验证", subtitle: "工具 / AgentRun / 检查点", icon: Wrench },
  { title: "回复与产出", subtitle: "回答 / 产出物 / 验证结论", icon: FileOutput },
]

function ArchNode({ title, subtitle, icon: Icon, className = "", compact = false }: NodeProps) {
  return (
    <div className={`rounded-md border border-augustus-border bg-augustus-bg-card shadow-[var(--augustus-shadow)] ${compact ? "p-3" : "p-4"} ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className={`${compact ? "h-4 w-4" : "h-5 w-5"} shrink-0 text-augustus-accent`} />
        <span className={`${compact ? "text-xs" : "text-sm"} font-medium tracking-[0.03em] text-augustus-text`}>{title}</span>
      </div>
      {subtitle ? <p className="mt-1.5 text-[11px] leading-4 text-augustus-text-muted">{subtitle}</p> : null}
    </div>
  )
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 items-center justify-center">
      <div className="relative h-px w-full bg-augustus-accent/70">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full border border-augustus-border bg-augustus-bg-card px-2 py-0.5 text-[9px] tracking-[0.12em] text-augustus-text-muted">
          {label}
        </span>
        <span className="absolute right-[-1px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[9px] border-y-transparent border-l-augustus-accent/80" />
      </div>
    </div>
  )
}

function PlaneCard({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string
  icon: ElementType
  tone: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-augustus-text">
        <Icon className="h-5 w-5 shrink-0" />
        {title}
      </div>
      {children}
    </div>
  )
}

export function CoreArchitectureMap() {
  return (
    <section className="rounded-md border border-augustus-border bg-augustus-bg-card p-2 shadow-[var(--augustus-shadow)] sm:p-3">
      <div className="hidden lg:block">
        <div className="relative aspect-video overflow-hidden rounded-md border border-augustus-border bg-augustus-bg">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(180deg,rgba(148,163,184,0.13)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30" />

          <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_minmax(0,0.72fr)_auto_auto] gap-3 p-7">
            <header className="flex items-start justify-between gap-8">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-augustus-accent">AUGUSTUS 核心架构</p>
                <h2 className="mt-2 text-3xl font-light tracking-[0.04em] text-augustus-text">
                  对话信息流：从自然表达，到可验证的长期沉淀
                </h2>
              </div>
              <div className="max-w-[260px] border-l border-augustus-accent/40 pl-4 text-right text-sm leading-6 text-augustus-text-muted">
                用户自然表达
                <br />
                Runtime 整理世界
              </div>
            </header>

            <div className="grid min-h-0 grid-cols-[1fr_42px_1.25fr_42px_1.25fr_42px_1.55fr_42px_1fr] items-center gap-2">
              <ArchNode title="用户" subtitle="自然语言 / 文件 / 目标" icon={MessageSquareText} />

              <FlowArrow label="统一消息" />

              <div className="rounded-md border border-augustus-border bg-augustus-bg-card p-3 shadow-[var(--augustus-shadow)]">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-augustus-text">
                  <Cable className="h-5 w-5 shrink-0 text-augustus-accent" />
                  渠道入口
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-augustus-text-muted">
                  {["Web", "飞书", "CLI", "API"].map((item) => (
                    <span key={item} className="rounded-sm border border-augustus-border bg-augustus-bg px-2 py-1 text-center">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <FlowArrow label="接口契约" />

              <ArchNode title="Backend 薄适配" subtitle="路由 / 鉴权 / requestId / 文件" icon={Network} />

              <FlowArrow label="receive()" />

              <div className="h-full rounded-md border border-augustus-accent/55 bg-augustus-accent-muted p-3 shadow-[var(--augustus-shadow)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-lg font-medium text-augustus-text">
                    <Braces className="h-5 w-5 shrink-0 text-augustus-accent" />
                    Runtime
                  </div>
                  <span className="rounded-sm border border-augustus-accent/35 bg-augustus-bg px-2 py-1 text-[10px] tracking-[0.14em] text-augustus-accent">
                    内核
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  <ArchNode compact title="上下文装配" subtitle="任务 / 会话 / 记忆唤醒" icon={Brain} />
                  <ArchNode compact title="主 Agent 循环" subtitle="继续、创建、委托、回复" icon={Bot} />
                  <ArchNode compact title="任务编排" subtitle="边界、状态、产出物归属" icon={CircleDot} />
                </div>
              </div>

              <FlowArrow label="返回结果" />

              <div className="rounded-md border border-augustus-border bg-augustus-bg-card p-3 shadow-[var(--augustus-shadow)]">
                <div className="flex items-center gap-2 text-sm font-medium text-augustus-text">
                  <Sparkles className="h-5 w-5 shrink-0 text-augustus-accent" />
                  用户可见结果
                </div>
                <div className="mt-3 grid gap-1.5 text-[11px] text-augustus-text-muted">
                  <span>自然回复</span>
                  <span>任务状态</span>
                  <span>文档 / 文件 / 报告</span>
                  <span>验证结论</span>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 grid-cols-[1fr_1fr_1fr] gap-3 border-y border-augustus-border/60 py-3">
              <PlaneCard title="Agent 层" icon={Bot} tone="border-violet-500/35 bg-violet-500/10 text-violet-500">
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  {["main", "coder", "researcher", "writer"].map((item) => (
                    <span key={item} className="rounded-sm border border-violet-500/25 bg-augustus-bg-card px-2 py-1 text-augustus-text-muted">
                      {item}
                    </span>
                  ))}
                </div>
              </PlaneCard>

              <PlaneCard title="行动层" icon={Wrench} tone="border-rose-500/35 bg-rose-500/10 text-rose-500">
                <div className="mt-3 grid gap-1.5 text-[11px] text-augustus-text-muted">
                  <span>工具注册 / 权限过滤</span>
                  <span>Shell / Git / 文件 / LLM</span>
                  <span>工作区授权 / 检查点</span>
                </div>
              </PlaneCard>

              <PlaneCard title="验证层" icon={CheckCircle2} tone="border-emerald-500/35 bg-emerald-500/10 text-emerald-500">
                <div className="mt-3 grid gap-1.5 text-[11px] text-augustus-text-muted">
                  <span>typecheck / test / lint</span>
                  <span>工具审计 / AgentRun</span>
                  <span>任务验证状态</span>
                </div>
              </PlaneCard>
            </div>

            <div className="rounded-md border border-augustus-border bg-augustus-bg-card/95 p-3 shadow-[var(--augustus-shadow)]">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-augustus-text">
                  <Database className="h-5 w-5 shrink-0 text-augustus-accent" />
                  持久化世界模型
                </div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-augustus-text-dim">
                  <Archive className="h-3.5 w-3.5" />
                  .augustus/
                </div>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {["tasks", "sessions", "agent-runs", "memory", "tool-runs", "files"].map((item) => (
                  <div key={item} className="rounded-sm border border-augustus-border bg-augustus-bg px-3 py-2 text-center font-mono text-[11px] text-augustus-text-muted">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <footer className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-augustus-text-dim">
              <span>实线：当前主流程</span>
              <span>中层：tool-call / multi agent / 验证闭环</span>
              <span>沉淀：记忆唤醒 / 经验回流</span>
            </footer>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3 lg:hidden">
        <div className="rounded-md border border-augustus-border bg-augustus-bg p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-augustus-accent">架构信息流</p>
          <h2 className="mt-2 text-xl font-light leading-tight text-augustus-text">对话信息流</h2>
        </div>
        {mobileFlow.map((node, index) => {
          const Icon = node.icon
          return (
            <div key={node.title}>
              <div className="rounded-md border border-augustus-border bg-augustus-bg p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-md border border-augustus-accent/35 bg-augustus-accent-muted text-xs text-augustus-accent">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-augustus-text">
                      <Icon className="h-4 w-4 shrink-0 text-augustus-accent" />
                      {node.title}
                    </div>
                    <p className="mt-1 text-xs text-augustus-text-muted">{node.subtitle}</p>
                  </div>
                </div>
              </div>
              {index < mobileFlow.length - 1 ? (
                <div className="mx-7 h-5 w-px bg-augustus-accent/45" />
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
