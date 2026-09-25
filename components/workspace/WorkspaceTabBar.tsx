"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Globe2, Home, ImageIcon, LayoutGrid, Settings, ShieldCheck, X, Plus } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import {
  subscribeToWorkspaceDocumentRemovals,
  subscribeToWorkspaceTabOpened,
} from "@/components/workspace/workspace-events";
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
  folderPathByHref,
}: {
  activePage: WorkspacePageDescriptor;
  initialTabs?: WorkspaceTab[];
  /**
   * Query-free document href -> the display path of the folder holding it.
   * Derived live from the sidebar tree rather than stored on the tab, because
   * tabs are persisted in a cookie and a folder can be renamed or moved while
   * a tab sits open.
   */
  folderPathByHref?: Map<string, string>;
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
  // Set when a drag begins so the click that fires right after the drop does
  // not navigate the tab's link. Reset on the next pointer down (a fresh
  // gesture), so a real tap is never swallowed.
  const justDraggedRef = useRef(false);
  // Mirrors `tabs` so the removal handler can read the freshest list and decide
  // the neighbor tab synchronously (no side effects inside a state updater).
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Mouse drags start after a small move; touch drags need a short press-and-
  // hold (so a quick horizontal swipe still scrolls the overflowing strip);
  // keyboard reordering works via the sortable coordinate getter.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  // Opens a tab in the background. Deliberately does not navigate: `/def`
  // creates a definition while the author is mid-sentence, and the point is that
  // they keep writing. Reads and writes `tabsRef` so a burst of these cannot
  // each start from the same stale list.
  useEffect(() => {
    return subscribeToWorkspaceTabOpened(({ href, title }) => {
      const currentTabs = tabsRef.current;

      if (currentTabs.some((tab) => tab.href === href)) {
        return;
      }

      const nextTabs = [
        ...currentTabs,
        { id: href, href, title, type: "document" as const },
      ].slice(-maxTabs);
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      writeWorkspaceTabsCookie(nextTabs);
    });
  }, []);

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setTabs((currentTabs) => {
      const fromIndex = currentTabs.findIndex((tab) => tab.href === active.id);
      const toIndex = currentTabs.findIndex((tab) => tab.href === over.id);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return currentTabs;
      }

      const nextTabs = arrayMove(currentTabs, fromIndex, toIndex);
      writeWorkspaceTabsCookie(nextTabs);
      return nextTabs;
    });
  }

  return (
    <div className="flex h-10 shrink-0 min-w-0 items-end overflow-x-auto border-b border-border/70 bg-background/95">
      <DndContext
        // Without an explicit id, dnd-kit derives `aria-describedby` from a
        // module-level counter (`useUniqueId`, not React's `useId`). That
        // counter keeps climbing across renders in the server process while it
        // restarts at 0 in the browser, so every SortableTab hydrated with a
        // mismatched attribute and React logged it on every page load. Any
        // stable string fixes it: `useUniqueId` returns the value it is given.
        id="workspace-tab-bar"
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={() => {
          justDraggedRef.current = true;
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-w-max items-end px-1">
          <SortableContext
            items={tabs.map((tab) => tab.href)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.href}
                tab={tab}
                isActive={tab.href === canonicalActiveHref}
                folderPath={folderPathByHref?.get(
                  tab.href.split("?")[0] ?? tab.href,
                )}
                justDraggedRef={justDraggedRef}
                onClose={closeTab}
              />
            ))}
          </SortableContext>
          <Link
            href="/workspace"
            aria-label="Open new tab"
            className="flex h-9 w-9 flex-none items-center justify-center border-r border-border/60 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="size-4" />
          </Link>
        </div>
      </DndContext>
    </div>
  );
}

function SortableTab({
  tab,
  isActive,
  folderPath,
  justDraggedRef,
  onClose,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  folderPath?: string;
  justDraggedRef: RefObject<boolean>;
  onClose: (tab: WorkspaceTab) => void;
}) {
  const Icon = iconByType[tab.type] ?? FileText;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.href });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      // `touch-pan-x` keeps the strip horizontally scrollable on touch; the
      // TouchSensor's press-and-hold delay is what distinguishes a scroll from
      // a reorder. `select-none` + no-callout stop text selection / the mobile
      // link menu that a long-press on the inner <a> would otherwise trigger.
      className={cn(
        "group relative flex h-9 min-w-36 max-w-56 flex-none touch-pan-x cursor-grab select-none items-center gap-2 border-r border-border/60 px-3 text-sm [-webkit-touch-callout:none] active:cursor-grabbing sm:min-w-44",
        isActive
          ? "border-t border-t-border bg-card text-foreground"
          : "bg-background/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        isDragging ? "z-10 opacity-95 shadow-lg shadow-black/30" : null,
      )}
      onPointerDownCapture={() => {
        // Fresh gesture: any prior drag-end click guard no longer applies.
        justDraggedRef.current = false;
      }}
      onContextMenu={(event) => event.preventDefault()}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose(tab);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <Link
        href={tab.href}
        draggable={false}
        // Two tabs can carry the same title from different folders, so the
        // hover hint is the full path when there is one.
        title={folderPath ? `${folderPath}/${tab.title}` : tab.title}
        onClick={(event) => {
          // Swallow the click synthesized right after a drag so it does not
          // navigate to the tab we just dropped.
          if (justDraggedRef.current) {
            event.preventDefault();
          }
        }}
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
        data-tab-close
        aria-label={`Close ${tab.title}`}
        // Keep a press on the close button from starting a drag: stop the
        // sensor activator events (mouse/touch) from reaching the tab's
        // drag listeners on the parent.
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={() => onClose(tab)}
        className={cn(
          "rounded-sm p-0.5 text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground",
          isActive ? "opacity-100" : "group-hover:opacity-100",
        )}
      >
        <X className="size-3.5" />
      </button>
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
