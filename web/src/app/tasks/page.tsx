"use client";

import { useEffect, useState, useMemo } from "react";
import { ListTodo } from "lucide-react";
import { api } from "@/lib/api";
import type { TaskSummary } from "@/lib/api-types";
import { TaskCard } from "@/components/task/task-card";
import { NavigationBar } from "@/components/navigation-bar";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "active", label: "活跃" },
  { key: "paused", label: "已暂停" },
  { key: "done", label: "已完成" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getTasks();
        if (res.ok) {
          setTasks(res.data!.tasks);
        } else {
          setError(res.error?.message ?? "加载失败");
        }
      } catch {
        setError("无法连接到 Backend");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: tasks.length, active: 0, paused: 0, done: 0 };
    for (const t of tasks) {
      if (t.status in c) c[t.status as "active" | "paused" | "done"]++;
    }
    return c;
  }, [tasks]);

  return (
    <div className="min-h-screen bg-augustus-bg">
      <NavigationBar />
      <div className="fixed inset-0 bg-gradient-to-b from-augustus-bg via-augustus-bg-card to-augustus-bg pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-3xl px-3 pb-12 pt-20 sm:px-4 sm:py-24">
        {/* Header */}
        <div className="mb-5 sm:mb-6">
          <h1 className="text-lg tracking-[0.12em] text-augustus-text/80 font-light sm:text-xl sm:tracking-[0.15em]">
            任务列表
          </h1>
          <p className="text-xs text-augustus-accent/40 tracking-[0.2em] mt-1">
            Task Registry
          </p>
        </div>

        {/* Filter tabs */}
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1 sm:mb-6">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filter === f.key
                  ? "bg-augustus-accent-muted border-augustus-accent-ring text-augustus-accent"
                  : "bg-augustus-bg-card border-augustus-border text-augustus-text-muted hover:border-augustus-border-hover"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-augustus-text-dim">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-augustus-bg-card border border-augustus-border rounded-md p-4">
                <div className="w-48 h-4 bg-augustus-border rounded animate-pulse mb-2" />
                <div className="w-72 h-3 bg-augustus-border rounded animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Task list */}
        {!loading && !error && (
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <ListTodo className="w-10 h-10 text-augustus-text-dim mx-auto mb-3" />
                <p className="text-sm text-augustus-text-muted">
                  {filter === "all" ? "暂无任务" : "没有匹配的任务"}
                </p>
                <p className="text-xs text-augustus-text-dim mt-1">
                  在对话页面创建新的任务
                </p>
              </div>
            ) : (
              filtered.map((task) => <TaskCard key={task.id} task={task} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
