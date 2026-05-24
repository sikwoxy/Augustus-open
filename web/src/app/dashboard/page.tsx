"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { api } from "@/lib/api"
import type { TaskSummary, StatusResponse, ReadyResponse } from "@/lib/api-types"
import { Loader2, Activity, CheckCircle, Clock, Zap, BarChart3, ChevronDown, ChevronUp, XCircle, AlertTriangle } from "lucide-react"
import { NavigationBar } from "@/components/navigation-bar"
import { HealthIndicator } from "@/components/status/health-indicator"
import { StatCard } from "@/components/status/stat-card"

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [ready, setReady] = useState<ReadyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checksOpen, setChecksOpen] = useState(true)
  const [runtimeOpen, setRuntimeOpen] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksRes, statusRes, readyRes] = await Promise.all([
          api.getTasks(),
          api.getStatus(),
          api.ready(),
        ])
        if (tasksRes.ok) setTasks(tasksRes.data.tasks)
        else setError(tasksRes.error.message)
        if (statusRes.ok) setStatus(statusRes.data)
        if (readyRes.ok) setReady(readyRes.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法连接到 Backend")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const activeCount = tasks.filter((t) => t.status === "active").length
  const doneCount = tasks.filter((t) => t.status === "done").length
  const pausedCount = tasks.filter((t) => t.status === "paused").length
  const archivedCount = tasks.filter((t) => t.status === "archived").length
  const total = tasks.length

  const overallHealth: "ok" | "warn" | "fail" | "pending" = error
    ? "fail"
    : status && ready
      ? ready.ready ? "ok" : "fail"
      : "pending"

  const statusDistribution = [
    { label: "活跃中", count: activeCount, color: "bg-blue-500" },
    { label: "已暂停", count: pausedCount, color: "bg-yellow-500" },
    { label: "已完成", count: doneCount, color: "bg-green-500" },
    { label: "已归档", count: archivedCount, color: "bg-gray-500" },
  ]

  return (
    <div className="min-h-screen bg-augustus-bg">
      <NavigationBar />
      <div className="fixed inset-0 bg-gradient-to-b from-augustus-bg via-augustus-bg-card to-augustus-bg pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl tracking-[0.15em] text-augustus-text/80 font-light">
            系统概览
          </h1>
          <p className="text-xs text-augustus-accent/40 tracking-[0.2em] mt-1">System Overview</p>
          <div className="mt-3">
            <HealthIndicator level={overallHealth} label={error ?? (ready?.ready ? "系统运行正常" : "系统异常")} />
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-augustus-accent/60 animate-spin" />
          </div>
        )}

        {error && !status && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-6 text-center mb-6">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-augustus-text-dim mt-1">请确认 backend 服务是否已启动</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Runtime stats */}
            {status && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard icon="⏱️" label="运行时长" value={formatUptime(status.uptimeMs)} />
                <StatCard icon="💬" label="活跃会话" value={String(status.sessionsLoaded)} />
                <StatCard icon="🤖" label="LLM" value={status.llmEnabled ? "已启用" : "未启用"} sub={status.version ? `v${status.version}` : undefined} />
                <StatCard icon="📋" label="任务总数" value={String(total)} />
              </div>
            )}

            {/* Task distribution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="border border-augustus-accent/20 rounded-md bg-augustus-accent-muted p-6 mb-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-augustus-accent" />
                <h2 className="text-sm font-medium text-augustus-text">任务状态分布</h2>
              </div>
              <div className="space-y-3">
                {statusDistribution.map((item) => {
                  const pct = total > 0 ? (item.count / total) * 100 : 0
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-augustus-text-muted">{item.label}</span>
                        <span className="text-augustus-text-dim font-mono">{item.count} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2 bg-augustus-input rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${item.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {/* Ready checks */}
            {ready && ready.checks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-augustus-bg-card border border-augustus-border rounded-md overflow-hidden mb-6"
              >
                <button
                  onClick={() => setChecksOpen(!checksOpen)}
                  className="w-full px-4 py-3 flex items-center justify-between border-b border-augustus-border hover:bg-augustus-accent-muted/50 transition-colors"
                >
                  <h2 className="text-sm text-augustus-text font-semibold">就绪检查</h2>
                  {checksOpen ? <ChevronUp className="w-4 h-4 text-augustus-text-muted" /> : <ChevronDown className="w-4 h-4 text-augustus-text-muted" />}
                </button>
                {checksOpen && (
                  <div className="divide-y divide-augustus-border">
                    {ready.checks.map((check, i) => (
                      <div key={i} className="px-4 py-3 flex items-center gap-3">
                        {check.ok ? (
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : check.name === "feishu" ? (
                          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-augustus-text">{check.name}</div>
                          {check.message && (
                            <div className="text-xs text-augustus-text-muted truncate">{check.message}</div>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          check.ok
                            ? "bg-green-500/10 text-green-400"
                            : check.name === "feishu"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-red-500/10 text-red-400"
                        }`}>
                          {check.ok ? "OK" : check.name === "feishu" ? "可选" : "FAIL"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* Runtime info - collapsible */}
            {status && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-augustus-bg-card border border-augustus-border rounded-md overflow-hidden"
              >
                <button
                  onClick={() => setRuntimeOpen(!runtimeOpen)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-augustus-accent-muted/50 transition-colors"
                >
                  <h2 className="text-sm text-augustus-text font-semibold">Runtime 信息</h2>
                  {runtimeOpen ? <ChevronUp className="w-4 h-4 text-augustus-text-muted" /> : <ChevronDown className="w-4 h-4 text-augustus-text-muted" />}
                </button>
                {runtimeOpen && (
                  <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono text-augustus-text-dim border-t border-augustus-border pt-3">
                    <div>dataDir: <span className="text-augustus-text-muted">{status.dataDir}</span></div>
                    <div>projectRoot: <span className="text-augustus-text-muted">{status.projectRoot}</span></div>
                    <div>sessionsLoaded: <span className="text-augustus-text-muted">{status.sessionsLoaded}</span></div>
                    <div>version: <span className="text-augustus-text-muted">{status.version ?? "--"}</span></div>
                  </div>
                )}
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
