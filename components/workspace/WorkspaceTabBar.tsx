"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Globe2, Home, LayoutGrid, Settings, ShieldCheck, X, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspacePageDescriptor, WorkspacePageType } from "@/components/workspace/workspace-types";

type WorkspaceTab = WorkspacePageDescriptor & {
  id: string;
};

const storageKey = "vault.workspace.tabs.v1";
const maxTabs = 12;

const iconByType: Record<WorkspacePageType, typeof Home> = {
  new: Home,
  document: FileText,
  public: Globe2,
  guide: FileText,
  gallery: LayoutGrid,
  settings: Settings,
  admin: ShieldCheck,
};

export function WorkspaceTabBar({ activePage }: { activePage: WorkspacePageDescriptor }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const activeHref = activePage.href || currentHref;
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    mergeActiveTab([], {
      ...activePage,
      href: activeHref,
      id: activeHref,
    }),
  );
  const [draggedHref, setDraggedHref] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTabs((currentTabs) => {
        const activeTab = { ...activePage, href: activeHref, id: activeHref };
        const baseTabs = currentTabs.length <= 1 ? readStoredTabs() : currentTabs;
        const nextTabs = mergeActiveTab(baseTabs, activeTab);

        window.localStorage.setItem(storageKey, JSON.stringify(nextTabs));
        return nextTabs;
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeHref, activePage]);

  function closeTab(tab: WorkspaceTab) {
    setTabs((currentTabs) => {
      const index = currentTabs.findIndex((candidate) => candidate.href === tab.href);
      const nextTabs = currentTabs.filter((candidate) => candidate.href !== tab.href);
      window.localStorage.setItem(storageKey, JSON.stringify(nextTabs));

      if (tab.href === activeHref) {
        const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
        router.push(nextActive?.href ?? "/workspace");
      }

      return nextTabs;
    });
  }

  function reorderTabs(fromHref: string, toHref: string) {
    if (fromHref === toHref) {
      return;
    }

    setTabs((currentTabs) => {
      const fromIndex = currentTabs.findIndex((tab) => tab.href === fromHref);
      const toIndex = currentTabs.findIndex((tab) => tab.href === toHref);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return currentTabs;
      }

      const nextTabs = [...currentTabs];
      const [movedTab] = nextTabs.splice(fromIndex, 1);

      if (!movedTab) {
        return currentTabs;
      }

      nextTabs.splice(toIndex, 0, movedTab);
      window.localStorage.setItem(storageKey, JSON.stringify(nextTabs));
      return nextTabs;
    });
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, tab: WorkspaceTab) {
    setDraggedHref(tab.href);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tab.href);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, tab: WorkspaceTab) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const sourceHref = draggedHref || event.dataTransfer.getData("text/plain");
    if (sourceHref) {
      reorderTabs(sourceHref, tab.href);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggedHref(null);
  }

  return (
    <div className="flex h-10 shrink-0 min-w-0 items-end overflow-x-auto border-b border-border/70 bg-background/95">
      <div className="flex min-w-max items-end px-1">
        {tabs.map((tab) => {
          const Icon = iconByType[tab.type] ?? FileText;
          const active = tab.href === activeHref;

          return (
            <div
              key={tab.href}
              draggable
              onDragStart={(event) => handleDragStart(event, tab)}
              onDragOver={(event) => handleDragOver(event, tab)}
              onDrop={handleDrop}
              onDragEnd={() => setDraggedHref(null)}
              className={cn(
                "group flex h-9 min-w-36 max-w-56 flex-none cursor-grab items-center gap-2 border-r border-border/60 px-3 text-sm transition active:cursor-grabbing sm:min-w-44",
                active
                  ? "border-t border-t-border bg-card text-foreground"
                  : "bg-background/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                draggedHref === tab.href && "opacity-55",
              )}
            >
              <Link href={tab.href} className="flex min-w-0 flex-1 items-center gap-2">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{tab.title}</span>
              </Link>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => closeTab(tab)}
                className={cn(
                  "rounded-sm p-0.5 text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground",
                  active ? "opacity-100" : "group-hover:opacity-100",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <Link
          href="/workspace"
          aria-label="Open new tab"
          className="flex h-9 w-9 flex-none items-center justify-center border-r border-border/60 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function mergeActiveTab(tabs: WorkspaceTab[], activeTab: WorkspaceTab) {
  const existingIndex = tabs.findIndex((tab) => tab.href === activeTab.href);

  return existingIndex >= 0
    ? tabs.map((tab, index) => (index === existingIndex ? activeTab : tab))
    : [...tabs, activeTab].slice(-maxTabs);
}

function readStoredTabs() {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  const raw = window.localStorage.getItem(storageKey);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isWorkspaceTab).slice(0, maxTabs)
      : [];
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceTab>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.href === "string" &&
    typeof candidate.type === "string"
  );
}
