import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Building blocks for the workspace's right-hand panel (documents, assets).
 * Every section reads the same way: an icon tile on the left, a title with an
 * optional one-line description, an optional action on the right, then the
 * section's controls. Sections are separated by hairlines and share one gutter.
 */

export function ContextPanelBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex flex-col text-sm", className)}>{children}</div>;
}

export function ContextPanelSection({
  icon: Icon,
  title,
  description,
  action,
  tone = "default",
  className,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** `danger` tints the icon tile for destructive sections (archive, delete). */
  tone?: "default" | "danger";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid gap-3 border-b border-border/60 px-4 py-4 last:border-b-0",
        className,
      )}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md border",
            tone === "danger"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border/70 bg-muted/40 text-muted-foreground",
          )}
          aria-hidden
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-7">{title}</h2>
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children ? <div className="grid min-w-0 gap-2">{children}</div> : null}
    </section>
  );
}

/** Small label/value rows (size, kind, dates) under a section. */
export function ContextPanelFacts({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-1.5 text-xs">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
