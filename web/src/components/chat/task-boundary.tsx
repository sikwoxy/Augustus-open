"use client";

import Link from "next/link";
import { GitBranch, MessageSquare } from "lucide-react";
import type { TaskStatus } from "@/lib/api-types";

interface Props {
  taskId: string | null;
  title?: string;
  status?: TaskStatus;
}

function shortId(taskId: string): string {
  return taskId.slice(-8);
}

export function TaskBoundary({ taskId, title, status }: Props) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-augustus-text-dim">
      <div className="h-px flex-1 bg-augustus-border/70" />
      {taskId ? (
        <Link
          href={`/tasks/${taskId}`}
          className="inline-flex max-w-[70%] items-center gap-2 rounded border border-augustus-border bg-augustus-bg-card/80 px-2.5 py-1 hover:border-augustus-accent-ring hover:text-augustus-accent"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">任务：{title ?? shortId(taskId)}</span>
          {status && (
            <span className="shrink-0 rounded border border-augustus-border px-1.5 py-0.5 text-[10px] text-augustus-text-dim">
              {status}
            </span>
          )}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-2 rounded border border-augustus-border bg-augustus-bg-card/80 px-2.5 py-1">
          <MessageSquare className="h-3.5 w-3.5" />
          临时问答
        </span>
      )}
      <div className="h-px flex-1 bg-augustus-border/70" />
    </div>
  );
}
