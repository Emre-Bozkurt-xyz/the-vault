"use client";

import Link from "next/link";
import {
  BookOpen,
  Files,
  ImageIcon,
  LayoutGrid,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspacePanelMode } from "@/components/workspace/workspace-types";

type WorkspaceIconRailProps = {
  mode: WorkspacePanelMode;
  onModeChange: (mode: WorkspacePanelMode) => void;
  isAdmin?: boolean;
};

export function WorkspaceIconRail({
  mode,
  onModeChange,
  isAdmin = false,
}: WorkspaceIconRailProps) {
  const items = [
    { label: "Files", mode: "files" as const, icon: Files },
    { label: "Search", mode: "search" as const, icon: Search },
    { label: "Gallery", mode: "gallery" as const, icon: LayoutGrid, href: "/gallery" },
    { label: "Assets", mode: "gallery" as const, icon: ImageIcon },
    { label: "Docs", mode: "docs" as const, icon: BookOpen, href: "/docs" },
    { label: "Settings", mode: "settings" as const, icon: Settings, href: "/dashboard/settings" },
    ...(isAdmin
      ? [{ label: "Admin", mode: "admin" as const, icon: ShieldCheck, href: "/dashboard/admin" }]
      : []),
  ];

  return (
    <nav className="hidden w-12 shrink-0 flex-col items-center border-r border-border/70 bg-sidebar py-2 text-sidebar-foreground md:flex">
      {items.map((item) => {
        const Icon = item.icon;
        const active = mode === item.mode;
        const className = cn(
          "mb-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          active && "bg-sidebar-accent text-sidebar-accent-foreground",
        );

        if (item.href) {
          return (
            <Link
              key={item.label}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              onClick={() => onModeChange(item.mode)}
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
            onClick={() => onModeChange(item.mode)}
            className={className}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </nav>
  );
}
