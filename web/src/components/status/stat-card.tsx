export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="bg-augustus-bg-card border border-augustus-border rounded-md p-4">
      <div className="text-xs text-augustus-text-muted mb-1 flex items-center gap-1.5">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className="text-lg font-semibold text-augustus-text">{value}</div>
      {sub && <div className="text-xs text-augustus-text-dim mt-0.5">{sub}</div>}
    </div>
  );
}
