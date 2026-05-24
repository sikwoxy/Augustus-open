import Link from "next/link";
import { TaskStatusBadge } from "./task-status-badge";
import type { TaskSummary } from "@/lib/api-types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function artifactName(uri: string): string {
  return uri.split(/[\\/]/).pop() || uri;
}

export function TaskCard({ task }: { task: TaskSummary }) {
  const artifactNames = task.artifacts?.slice(0, 2).map((artifact) => artifactName(artifact.uri)) ?? [];

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="group block rounded-md border border-augustus-border bg-augustus-bg-card p-3 transition-colors hover:border-augustus-border-hover sm:p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex min-w-0 items-start gap-2">
            <h3 className="text-sm font-semibold text-augustus-text group-hover:text-augustus-accent transition-colors truncate">
              {task.title}
            </h3>
            <div className="shrink-0">
              <TaskStatusBadge status={task.status} />
            </div>
          </div>
          {task.goal && (
            <p className="text-xs text-augustus-text-muted line-clamp-1">{task.goal}</p>
          )}
          {task.summary && (
            <p className="text-xs text-augustus-text-dim line-clamp-2 mt-1">{task.summary}</p>
          )}
          {artifactNames.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {artifactNames.map((name) => (
                <span
                  key={name}
                  className="max-w-full truncate rounded border border-augustus-border bg-augustus-bg/60 px-1.5 py-0.5 text-[11px] text-augustus-text-muted sm:max-w-[12rem]"
                  title={name}
                >
                  {name}
                </span>
              ))}
              {(task.artifacts?.length ?? 0) > artifactNames.length && (
                <span className="rounded border border-augustus-border bg-augustus-bg/60 px-1.5 py-0.5 text-[11px] text-augustus-text-dim">
                  +{(task.artifacts?.length ?? 0) - artifactNames.length}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-augustus-text-dim sm:block sm:text-right">
          <div>{formatTime(task.updatedAt)}</div>
          {task.artifacts && task.artifacts.length > 0 && (
            <div className="text-augustus-accent/60 mt-1">{task.artifacts.length} 个产出物</div>
          )}
        </div>
      </div>
    </Link>
  );
}
