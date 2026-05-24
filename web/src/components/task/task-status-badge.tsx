type TaskStatus = "active" | "paused" | "done" | "archived";

const config: Record<TaskStatus, { label: string; className: string }> = {
  active: {
    label: "活跃",
    className: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  paused: {
    label: "已暂停",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  done: {
    label: "已完成",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  archived: {
    label: "已归档",
    className: "bg-augustus-text-dim/10 text-augustus-text-dim border-augustus-text-dim/20",
  },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { label, className } = config[status] ?? config.archived;
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${className}`}>
      {label}
    </span>
  );
}
