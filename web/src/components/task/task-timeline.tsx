interface TimelineItem {
  label: string;
  value: string;
  time?: number;
}

export function TaskTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-2 h-2 rounded-full ${i === 0 ? "bg-augustus-accent" : "bg-augustus-border"}`} />
            {i < items.length - 1 && <div className="w-px flex-1 bg-augustus-border mt-1" />}
          </div>
          <div className="flex-1 pb-3">
            <div className="text-xs text-augustus-text-muted">{item.label}</div>
            <div className="text-sm text-augustus-text mt-0.5">{item.value}</div>
            {item.time && (
              <div className="text-xs text-augustus-text-dim mt-0.5">
                {new Date(item.time).toLocaleString("zh-CN")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
