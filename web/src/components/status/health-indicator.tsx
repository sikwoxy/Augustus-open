import { cn } from "@/lib/utils";

type HealthLevel = "ok" | "warn" | "fail" | "pending";

const dots: Record<HealthLevel, string> = {
  ok: "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]",
  warn: "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]",
  fail: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
  pending: "bg-gray-500 animate-pulse",
};

const labels: Record<HealthLevel, string> = {
  ok: "正常",
  warn: "警告",
  fail: "异常",
  pending: "检测中",
};

export function HealthIndicator({
  level,
  label,
  className,
}: {
  level: HealthLevel;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span className={cn("w-2 h-2 rounded-full", dots[level])} />
      <span className="text-augustus-text-muted">{label ?? labels[level]}</span>
    </div>
  );
}
