"use client";

import Link from "next/link";
import {
  BookOpen,
  Files,
  ImageIcon,
  LayoutGrid,
  ListChecks,
  Search,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspacePanelMode } from "@/components/workspace/workspace-types";

type WorkspaceIconRailProps = {
  mode: WorkspacePanelMode;
  /** Whether the left panel is collapsed; changes what a click does. */
  collapsed: boolean;
  /**
   * `navigates` is true when the click also loads a page, in which case a
   * collapsed panel should stay collapsed.
   */
  onSelect: (mode: WorkspacePanelMode, options: { navigates: boolean }) => void;
  isAdmin?: boolean;
  /** The Tasks agenda is the `vault.tasks` extension's; hidden while it is off. */
  tasksEnabled?: boolean;
};

type RailItem = {
  label: string;
  mode: WorkspacePanelMode;
  icon: typeof Files;
  /** Always navigates here. */
  href?: string;
  /** Navigates here only while the panel is collapsed (else switches panel). */
  collapsedHref?: string;
};

export function WorkspaceIconRail({
  mode,
  collapsed,
  onSelect,
  isAdmin = false,
  tasksEnabled = false,
}: WorkspaceIconRailProps) {
  const items: RailItem[] = [
    { label: "Files", mode: "files", icon: Files },
    { label: "Search", mode: "search", icon: Search },
    ...(tasksEnabled
      ? [{ label: "Tasks", mode: "tasks" as const, icon: ListChecks, collapsedHref: "/tasks" }]
      : []),
    { label: "Gallery", mode: "gallery", icon: LayoutGrid, href: "/gallery" },
    { label: "Assets", mode: "assets", icon: ImageIcon, href: "/assets" },
    { label: "Docs", mode: "docs", icon: BookOpen },
    ...(isAdmin
      ? [{ label: "Admin", mode: "admin" as const, icon: ShieldCheck, href: "/dashboard/admin" }]
      : []),
  ];

  return (
    <nav className="hidden w-12 shrink-0 flex-col items-center border-r border-border/70 bg-sidebar py-2 text-sidebar-foreground md:flex">
      <div className="flex flex-col items-center">
        {items.map((item) => {
          const Icon = item.icon;
          const active = mode === item.mode;
          const href = item.href ?? (collapsed ? item.collapsedHref : undefined);
          const className = cn(
            "mb-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            active && "bg-sidebar-accent text-sidebar-accent-foreground",
          );

          if (href) {
            return (
              <Link
                key={item.label}
                href={href}
                title={item.label}
                aria-label={item.label}
                onClick={() => onSelect(item.mode, { navigates: true })}
                className={className}
              >
                <Icon className="size-4" />
              </Link>
            );
          }

          return (
            <button
              key={item.label}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={active && !collapsed}
              onClick={() => onSelect(item.mode, { navigates: false })}
              className={className}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
