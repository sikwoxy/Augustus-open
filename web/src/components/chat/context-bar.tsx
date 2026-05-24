"use client";

import Link from "next/link";
import { AlertTriangle, GitBranch, MessageSquare } from "lucide-react";
import type { ContextHealth, TaskSummary, WorkingContextSummary } from "@/lib/api-types";

interface Props {
  context: WorkingContextSummary | null;
  currentTask: TaskSummary | null;
  health?: ContextHealth;
}

export function ContextBar({ context, currentTask, health }: Props) {
  const load = health?.estimatedContextLoad ?? "low";
  const hasWarning = Boolean(health?.warnings.length);
  const relatedTaskId = currentTask?.id ?? context?.currentTaskId ?? context?.taskIds[context.taskIds.length - 1];
  const relatedTask = relatedTaskId
    ? currentTask ?? context?.taskRefs.find((task) => task.id === relatedTaskId)
    : null;

  return (
    <div className="mx-auto mb-4 max-w-4xl rounded-md border border-augustus-border bg-augustus-bg-card/85 px-4 py-3 text-xs text-augustus-text-muted">
      <div className="flex flex-wrap items-center gap-3">
        {currentTask ? (
          <Link
            href={`/tasks/${currentTask.id}`}
            className="inline-flex items-center gap-2 text-augustus-text/85 hover:text-augustus-accent"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>当前任务：{currentTask.title}</span>
            <span className="rounded border border-augustus-border px-1.5 py-0.5 text-[10px] text-augustus-text-dim">
              {currentTask.status}
            </span>
          </Link>
        ) : (
          relatedTaskId ? (
            <Link
              href={`/tasks/${relatedTaskId}`}
              className="inline-flex items-center gap-2 text-augustus-text/85 hover:text-augustus-accent"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>历史任务上下文：{relatedTask?.title ?? relatedTaskId.slice(-8)}</span>
              <span className="rounded border border-augustus-border px-1.5 py-0.5 text-[10px] text-augustus-text-dim">
                {relatedTask?.status ?? "查看任务"}
              </span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5" />
              临时问答上下文
            </span>
          )
        )}

        <span className="text-augustus-text-dim">
          短期上下文：{load === "high" ? "较长" : load === "medium" ? "适中" : "轻量"}
        </span>

        {context?.taskIds.length ? (
          <span className="text-augustus-text-dim">
            关联任务 {context.taskIds.length} 个
          </span>
        ) : null}
      </div>

      {hasWarning && (
        <div className="mt-2 flex items-start gap-2 text-augustus-accent">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{health?.warnings[0]?.message}</span>
        </div>
      )}
    </div>
  );
}
