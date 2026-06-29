import type { ReactNode } from "react";

import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MetricCard({
  icon,
  label,
  value,
  hint,
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-border/60 bg-background/45 px-3 py-2.5",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function UsageBar({
  used,
  quota,
  showLabel = true,
  className,
}: {
  used: number;
  quota: number;
  showLabel?: boolean;
  className?: string;
}) {
  const ratio = quota > 0 ? Math.min(used / quota, 1) : 0;
  const percent = Math.round(ratio * 100);
  const nearLimit = ratio >= 0.9;

  return (
    <div className={cn("grid gap-1", className)}>
      {showLabel ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {formatBytes(used)} of {formatBytes(quota)}
          </span>
          <span>{percent}%</span>
        </div>
      ) : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            nearLimit ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.max(ratio * 100, used > 0 ? 1 : 0)}%` }}
        />
      </div>
    </div>
  );
}
