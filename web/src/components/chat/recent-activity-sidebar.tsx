"use client";

import Link from "next/link";
import { Clock, ExternalLink, MessageSquare, Plus, RefreshCw } from "lucide-react";
import type { WorkingContextSummary } from "@/lib/api-types";

interface Props {
  contexts: WorkingContextSummary[];
  currentContextId: string | null;
  loading?: boolean;
  onSelect: (context: WorkingContextSummary) => void;
  onNewContext: () => void;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContextItem({
  context,
  active,
  onSelect,
}: {
  context: WorkingContextSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const taskId = context.currentTaskId ?? context.taskIds[context.taskIds.length - 1];
  const taskRef = taskId ? context.taskRefs.find((task) => task.id === taskId) : undefined;

  return (
    <div
      className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
        active
          ? "border-augustus-accent-ring bg-augustus-accent-muted"
          : "border-augustus-border bg-augustus-bg-card/70 hover:border-augustus-accent-ring/60"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm text-augustus-text/85">{context.title}</div>
            {context.lastMessagePreview && (
              <div className="mt-1 line-clamp-2 text-xs text-augustus-text-muted">
                {context.lastMessagePreview}
              </div>
            )}
          </div>
          <span className="shrink-0 rounded border border-augustus-border px-1.5 py-0.5 text-[10px] text-augustus-text-dim">
            {taskRef?.status ?? (context.kind === "task_related" ? "任务" : "临时")}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-augustus-text-dim">
          <Clock className="h-3 w-3" />
          <span>{formatTime(context.updatedAt)}</span>
          <span>{context.userMessageCount + context.assistantMessageCount} 条</span>
        </div>
      </button>

      {taskId && (
        <div className="mt-2 border-t border-augustus-border/70 pt-2">
          <Link
            href={`/tasks/${taskId}`}
            className="inline-flex items-center gap-1 text-[11px] text-augustus-accent hover:text-augustus-accent-hover"
          >
            查看任务
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

export function RecentActivitySidebar({
  contexts,
  currentContextId,
  loading,
  onSelect,
  onNewContext,
}: Props) {
  const taskContexts = contexts.filter((context) => context.kind === "task_related");
  const temporaryContexts = contexts.filter((context) => context.kind === "temporary");

  return (
    <aside className="h-full w-80 shrink-0 overflow-y-auto border-r border-augustus-border bg-augustus-bg/80 px-3 py-4 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-augustus-text/85">近期活动</div>
          <div className="text-xs text-augustus-text-dim">任务脉络与临时问答</div>
        </div>
        <button
          type="button"
          onClick={onNewContext}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-augustus-border text-augustus-text-muted hover:border-augustus-accent-ring hover:text-augustus-accent"
          title="新的工作上下文"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-augustus-border bg-augustus-bg-card px-3 py-2 text-xs text-augustus-text-muted">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          正在恢复近期活动
        </div>
      ) : contexts.length === 0 ? (
        <div className="rounded-md border border-augustus-border bg-augustus-bg-card px-3 py-4 text-xs text-augustus-text-muted">
          暂无历史活动。第一次发送消息后会形成一个工作上下文。
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs text-augustus-text-muted">
              <MessageSquare className="h-3.5 w-3.5" />
              任务脉络
            </div>
            <div className="space-y-2">
              {taskContexts.length > 0 ? taskContexts.map((context) => (
                <ContextItem
                  key={context.contextId}
                  context={context}
                  active={context.contextId === currentContextId}
                  onSelect={() => onSelect(context)}
                />
              )) : (
                <div className="rounded-md border border-augustus-border/70 px-3 py-2 text-xs text-augustus-text-dim">
                  暂无任务相关活动
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 text-xs text-augustus-text-muted">
              <MessageSquare className="h-3.5 w-3.5" />
              临时问答
            </div>
            <div className="space-y-2">
              {temporaryContexts.length > 0 ? temporaryContexts.map((context) => (
                <ContextItem
                  key={context.contextId}
                  context={context}
                  active={context.contextId === currentContextId}
                  onSelect={() => onSelect(context)}
                />
              )) : (
                <div className="rounded-md border border-augustus-border/70 px-3 py-2 text-xs text-augustus-text-dim">
                  暂无临时问答
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
