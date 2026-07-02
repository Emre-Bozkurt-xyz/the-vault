"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Globe2, Home, ImageIcon, LayoutGrid, Settings, ShieldCheck, X, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { subscribeToWorkspaceDocumentRemovals } from "@/components/workspace/workspace-events";
import {
  maxWorkspaceTabs as maxTabs,
  writeWorkspaceTabsCookie,
} from "@/lib/workspace-layout";
import type {
  WorkspacePageDescriptor,
  WorkspacePageType,
  WorkspaceTab,
} from "@/components/workspace/workspace-types";

const iconByType: Record<WorkspacePageType, typeof Home> = {
  new: Home,
  document: FileText,
  public: Globe2,
  guide: FileText,
  gallery: LayoutGrid,
  assets: ImageIcon,
  settings: Settings,
  admin: ShieldCheck,
};

export function WorkspaceTabBar({
  activePage,
  initialTabs,
}: {
  activePage: WorkspacePageDescriptor;
  initialTabs?: WorkspaceTab[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const activeHref = activePage.href || currentHref;
  const canonicalActiveHref = canonicalWorkspaceTabHref(activeHref, activePage.type);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    mergeActiveTab(initialTabs ?? [], {
      ...activePage,
      href: canonicalActiveHref,
      id: canonicalActiveHref,
    }),
  );
  const [draggedHref, setDraggedHref] = useState<string | null>(null);
  // Mirrors `tabs` so the removal handler can read the freshest list and decide
  // the neighbor tab synchronously (no side effects inside a state updater).
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTabs((currentTabs) => {
        const activeTab = {
          ...activePage,
          href: canonicalActiveHref,
          id: canonicalActiveHref,
        };
        const nextTabs = mergeActiveTab(currentTabs, activeTab);

        writeWorkspaceTabsCookie(nextTabs);
        return nextTabs;
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activePage, canonicalActiveHref]);

  useEffect(() => {
    return subscribeToWorkspaceDocumentRemovals(({ id }) => {
      const currentTabs = tabsRef.current;
      const firstRemovedIndex = currentTabs.findIndex((tab) =>
        isDocumentTabForId(tab, id),
      );

      if (firstRemovedIndex < 0) {
        return;
      }

      const nextTabs = currentTabs.filter((tab) => !isDocumentTabForId(tab, id));
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      writeWorkspaceTabsCookie(nextTabs);

      // Only redirect when the closed tab was the active one. Prefer the tab to
      // the left; fall back to the one that shifted into its place (the right
      // neighbor), then the first tab, then the empty new-tab view.
      if (isDocumentHrefForId(canonicalActiveHref, id)) {
        const nextActive =
          nextTabs[Math.max(0, firstRemovedIndex - 1)] ??
          nextTabs[firstRemovedIndex] ??
          nextTabs[0];

        router.push(nextActive?.href ?? "/workspace");
      }
    });
  }, [canonicalActiveHref, router]);

  function closeTab(tab: WorkspaceTab) {
    setTabs((currentTabs) => {
      const index = currentTabs.findIndex((candidate) => candidate.href === tab.href);
      const nextTabs = currentTabs.filter((candidate) => candidate.href !== tab.href);
      writeWorkspaceTabsCookie(nextTabs);

      if (tab.href === canonicalActiveHref) {
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
      writeWorkspaceTabsCookie(nextTabs);
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
          const active = tab.href === canonicalActiveHref;

          return (
            <div
              key={tab.href}
              draggable
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab);
                }
              }}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                }
              }}
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
              <Link
                href={tab.href}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                  }
                }}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
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
  const normalizedActiveTab = normalizeWorkspaceTab(activeTab);
  const normalizedTabs = dedupeWorkspaceTabs(tabs.map(normalizeWorkspaceTab));
  const existingIndex = normalizedTabs.findIndex(
    (tab) => tab.href === normalizedActiveTab.href,
  );

  return existingIndex >= 0
    ? normalizedTabs.map((tab, index) =>
        index === existingIndex ? normalizedActiveTab : tab,
      )
    : [...normalizedTabs, normalizedActiveTab].slice(-maxTabs);
}

function normalizeWorkspaceTab(tab: WorkspaceTab): WorkspaceTab {
  const href = canonicalWorkspaceTabHref(tab.href, tab.type);

  return {
    ...tab,
    href,
    id: href,
  };
}

function canonicalWorkspaceTabHref(href: string, type: WorkspacePageType) {
  const pathname = href.split("?")[0] ?? href;

  if (type === "gallery" && pathname === "/gallery") {
    return pathname;
  }

  if (type === "assets" && pathname === "/assets") {
    return pathname;
  }

  return href;
}

function dedupeWorkspaceTabs(tabs: WorkspaceTab[]) {
  const seen = new Set<string>();
  const next: WorkspaceTab[] = [];

  for (const tab of tabs) {
    if (seen.has(tab.href)) {
      continue;
    }

    seen.add(tab.href);
    next.push(tab);
  }

  return next;
}

function isDocumentTabForId(tab: WorkspaceTab, documentId: string) {
  return tab.type === "document" && isDocumentHrefForId(tab.href, documentId);
}

function isDocumentHrefForId(href: string, documentId: string) {
  return (href.split("?")[0] ?? href) === `/docs/${documentId}`;
}
