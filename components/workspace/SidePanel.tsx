"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, Search, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The left workspace panel's shared skeleton. Every mode (files, search,
 * tasks, gallery, assets, docs, admin) is built from these so they read as one
 * system: a fixed header (icon, title, actions), optional toolbar row (search,
 * capture), then a scrolling body of titled sections holding nav rows.
 */

export function SidePanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex h-full min-h-0 flex-col", className)}>{children}</div>;
}

export function SidePanelHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border/70 pl-3 pr-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold leading-tight">{title}</h2>
        {subtitle ? (
          <p className="truncate text-[0.7rem] leading-tight text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </header>
  );
}

/** Square icon button for header actions; a link when `href` is given. */
export function SidePanelAction({
  icon: Icon,
  label,
  href,
  onClick,
  disabled,
  spinning,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  const className =
    "grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50";
  const icon = <Icon className={cn("size-4", spinning && "animate-spin")} />;

  if (href) {
    return (
      <Link href={href} className={className} title={label} aria-label={label}>
        {icon}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

/** A full-width row under the header: search fields, quick capture. */
export function SidePanelToolbar({ children }: { children: ReactNode }) {
  return <div className="shrink-0 border-b border-border/70 px-3 py-2">{children}</div>;
}

export function SidePanelSearch({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  label: string;
}) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <label className="flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
    </form>
  );
}

export function SidePanelBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2", className)}>
      {children}
    </div>
  );
}

/**
 * A titled group of rows. `collapsible` sections remember nothing between
 * mounts on purpose: panels are cheap to re-open and start predictable.
 */
export function SidePanelSection({
  title,
  count,
  action,
  collapsible = false,
  defaultOpen = true,
  tone = "default",
  className,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: "default" | "danger";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = (
    <>
      {collapsible ? (
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden
        />
      ) : null}
      <span className="truncate">{title}</span>
      {count !== undefined ? (
        <span className="ml-auto pl-2 font-normal tabular-nums">{count}</span>
      ) : null}
    </>
  );
  const headingClass = cn(
    "flex h-7 min-w-0 flex-1 items-center gap-1 px-2 text-[0.66rem] font-semibold uppercase tracking-[0.16em]",
    tone === "danger" ? "text-destructive" : "text-muted-foreground",
  );

  return (
    <section className={cn("mb-3 last:mb-0", className)}>
      <div className="flex items-center">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className={cn(headingClass, "rounded-md text-left transition hover:text-foreground")}
          >
            {heading}
          </button>
        ) : (
          <h3 className={headingClass}>{heading}</h3>
        )}
        {action ? <div className="shrink-0 pr-1">{action}</div> : null}
      </div>
      {!collapsible || open ? <div className="mt-0.5 grid gap-0.5">{children}</div> : null}
    </section>
  );
}

/** A navigation row. Two lines when `detail` is set. */
export function SidePanelNavItem({
  href,
  icon: Icon,
  leading,
  label,
  detail,
  trailing,
  active = false,
  onClick,
}: {
  href: string;
  icon?: LucideIcon;
  /** Replaces the icon, e.g. a thumbnail. */
  leading?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-md px-2 text-sm transition",
        detail ? "py-1.5" : "h-8",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      {leading ??
        (Icon ? (
          <Icon
            className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")}
            aria-hidden
          />
        ) : null)}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", active ? "text-foreground" : "text-foreground/90")}>
          {label}
        </span>
        {detail ? (
          <span className="block truncate text-xs font-normal text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {trailing !== undefined && trailing !== null ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{trailing}</span>
      ) : null}
    </Link>
  );
}

export function SidePanelEmpty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * Matches panel links against the current URL. A link is active when its path
 * matches (or prefixes, with `prefix`) and every query param it sets matches;
 * `filterKeys` are params that must be absent when the link does not set them,
 * so "All assets" is not active while `?kind=image` is applied.
 */
export function useActiveHref() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (href: string, options: { prefix?: boolean; filterKeys?: string[] } = {}) => {
      const target = new URL(href, "http://vault.local");
      const pathMatches = options.prefix
        ? pathname === target.pathname || pathname.startsWith(`${target.pathname}/`)
        : pathname === target.pathname;

      if (!pathMatches) return false;

      for (const [key, value] of target.searchParams) {
        if (searchParams.get(key) !== value) return false;
      }

      return (options.filterKeys ?? []).every(
        (key) => target.searchParams.has(key) || !searchParams.has(key),
      );
    },
    [pathname, searchParams],
  );
}
