"use client";

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
  /** Whether the left panel is collapsed (the active icon shows unpressed). */
  collapsed: boolean;
  /** Every icon only switches the left panel; panels hold the navigation. */
  onSelect: (mode: WorkspacePanelMode) => void;
  isAdmin?: boolean;
  /** The Tasks agenda is the `vault.tasks` extension's; hidden while it is off. */
  tasksEnabled?: boolean;
};

export function railItems(isAdmin: boolean, tasksEnabled: boolean) {
  return [
    { label: "Files", mode: "files" as const, icon: Files },
    { label: "Search", mode: "search" as const, icon: Search },
    ...(tasksEnabled ? [{ label: "Tasks", mode: "tasks" as const, icon: ListChecks }] : []),
    { label: "Gallery", mode: "gallery" as const, icon: LayoutGrid },
    { label: "Assets", mode: "assets" as const, icon: ImageIcon },
    { label: "Docs", mode: "docs" as const, icon: BookOpen },
    ...(isAdmin ? [{ label: "Admin", mode: "admin" as const, icon: ShieldCheck }] : []),
  ];
}

export function WorkspaceIconRail({
  mode,
  collapsed,
  onSelect,
  isAdmin = false,
  tasksEnabled = false,
}: WorkspaceIconRailProps) {
  return (
    <nav
      aria-label="Side panels"
      className="hidden w-12 shrink-0 flex-col items-center border-r border-border/70 bg-sidebar py-2 text-sidebar-foreground md:flex"
    >
      <div className="flex flex-col items-center">
        {railItems(isAdmin, tasksEnabled).map((item) => {
          const Icon = item.icon;
          const open = mode === item.mode && !collapsed;

          return (
            <button
              key={item.label}
              type="button"
              title={open ? `Hide ${item.label}` : item.label}
              aria-label={item.label}
              aria-pressed={open}
              onClick={() => onSelect(item.mode)}
              className={cn(
                "relative mb-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                open && "bg-sidebar-accent text-sidebar-accent-foreground",
                // The remembered mode stays marked while the panel is closed.
                mode === item.mode &&
                  collapsed &&
                  "after:absolute after:-left-2 after:top-1/2 after:h-3 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-muted-foreground/60",
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
