"use client";

import { type ReactNode, useState } from "react";
import {
  BookOpen,
  Files,
  GripVertical,
  ImageIcon,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { openWorkspaceSettings } from "@/components/settings/SettingsModalController";
import { cn } from "@/lib/utils";
import { WorkspaceIconRail } from "@/components/workspace/WorkspaceIconRail";
import { WorkspaceCommandPalette } from "@/components/workspace/WorkspaceCommandPalette";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import {
  clampWidth,
  leftPanelWidthBounds,
  rightPanelWidthBounds,
  writeWorkspaceLayoutCookie,
} from "@/lib/workspace-layout";
import type {
  WorkspaceLayoutState,
  WorkspacePageDescriptor,
  WorkspacePanelMode,
  WorkspaceTab,
} from "@/components/workspace/workspace-types";

type VaultWorkspaceShellProps = {
  activePage: WorkspacePageDescriptor;
  isAdmin?: boolean;
  filePanel: ReactNode;
  docsPanel?: ReactNode;
  searchPanel?: ReactNode;
  galleryPanel?: ReactNode;
  assetsPanel?: ReactNode;
  adminPanel?: ReactNode;
  defaultPanelMode?: WorkspacePanelMode;
  initialLayout?: Partial<WorkspaceLayoutState>;
  initialTabs?: WorkspaceTab[];
  contentClassName?: string;
  children: ReactNode;
  rightPanel?: ReactNode;
};

export function VaultWorkspaceShell({
  activePage,
  isAdmin = false,
  filePanel,
  docsPanel,
  searchPanel,
  galleryPanel,
  assetsPanel,
  adminPanel,
  defaultPanelMode = "files",
  initialLayout,
  initialTabs,
  contentClassName,
  children,
  rightPanel,
}: VaultWorkspaceShellProps) {
  const [panelMode, setPanelMode] = useState<WorkspacePanelMode>(
    initialLayout?.panelMode ?? defaultPanelMode,
  );
  const [leftCollapsed, setLeftCollapsed] = useState(
    initialLayout?.leftCollapsed ?? false,
  );
  const [leftPanelWidth, setLeftPanelWidth] = useState(
    initialLayout?.leftWidth ?? leftPanelWidthBounds.default,
  );
  const [rightCollapsed, setRightCollapsed] = useState(
    initialLayout?.rightCollapsed ?? false,
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(
    initialLayout?.rightWidth ?? rightPanelWidthBounds.default,
  );
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);

  // Persist the full layout to a cookie so the server can render it on the next
  // load. `overrides` carries the values that just changed, since their state
  // setters are async and would otherwise be stale in this closure.
  function persistLayout(overrides: Partial<WorkspaceLayoutState>) {
    writeWorkspaceLayoutCookie({
      panelMode,
      leftCollapsed,
      leftWidth: leftPanelWidth,
      rightCollapsed,
      rightWidth: rightPanelWidth,
      ...overrides,
    });
  }

  function changeMode(mode: WorkspacePanelMode) {
    setPanelMode(mode);
    setLeftCollapsed(false);
    persistLayout({ panelMode: mode, leftCollapsed: false });
  }

  function toggleLeftPanel() {
    setLeftCollapsed((current) => {
      const next = !current;
      persistLayout({ leftCollapsed: next });
      return next;
    });
  }

  function toggleRightPanel() {
    setRightCollapsed((current) => {
      const next = !current;
      persistLayout({ rightCollapsed: next });
      return next;
    });
  }

  function startPanelResize(
    panel: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = panel === "left" ? leftPanelWidth : rightPanelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let lastWidth = startWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth =
        panel === "left"
          ? clampWidth(
              startWidth + delta,
              leftPanelWidthBounds.min,
              leftPanelWidthBounds.max,
            )
          : clampWidth(
              startWidth - delta,
              rightPanelWidthBounds.min,
              rightPanelWidthBounds.max,
            );

      lastWidth = nextWidth;

      if (panel === "left") {
        setLeftPanelWidth(nextWidth);
      } else {
        setRightPanelWidth(nextWidth);
      }
    }

    function onPointerUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      // Persist once at the end of the drag rather than on every move.
      persistLayout(panel === "left" ? { leftWidth: lastWidth } : { rightWidth: lastWidth });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  const activePanel =
    panelMode === "files"
      ? filePanel
      : panelMode === "docs"
        ? docsPanel
        : panelMode === "search"
          ? searchPanel
          : panelMode === "gallery"
            ? galleryPanel
            : panelMode === "assets"
              ? assetsPanel
              : panelMode === "admin"
                ? adminPanel
                : null;

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WorkspaceIconRail mode={panelMode} onModeChange={changeMode} isAdmin={isAdmin} />

      <aside
        className={cn(
          "hidden h-full min-h-0 shrink-0 overflow-hidden border-r border-border/70 bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:block",
        )}
        style={{ width: leftCollapsed ? 0 : leftPanelWidth }}
      >
        {activePanel}
        {!activePanel ? (
          <PlaceholderPanel mode={panelMode} />
        ) : null}
      </aside>
      {!leftCollapsed ? (
        <ResizeHandle
          label="Resize navigation panel"
          side="left"
          onPointerDown={(event) => startPanelResize("left", event)}
        />
      ) : null}

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspaceTabBar activePage={activePage} initialTabs={initialTabs} />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div
              className={cn(
                "mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-4 py-4 md:px-8 md:py-7",
                contentClassName,
              )}
            >
              <div className="mb-4 flex items-center gap-2 md:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMobilePanelOpen(true)}
                  className="gap-2"
                >
                  <PanelLeftOpen className="size-4" />
                  Panel
                </Button>
                {rightPanel ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMobileRightPanelOpen(true)}
                    className="gap-2"
                  >
                    <PanelRightOpen className="size-4" />
                    Context
                  </Button>
                ) : null}
              </div>
              {children}
            </div>
          </main>

          {rightPanel ? (
            rightCollapsed ? (
              <aside className="hidden h-full min-h-0 w-9 shrink-0 border-l border-border/70 bg-card/30 lg:flex">
                <button
                  type="button"
                  onClick={toggleRightPanel}
                  className="flex h-11 w-full items-center justify-center text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                  aria-label="Show context panel"
                  title="Show context panel"
                >
                  <PanelRightOpen className="size-4" />
                </button>
              </aside>
            ) : (
              <>
                <ResizeHandle
                  label="Resize context panel"
                  side="right"
                  onPointerDown={(event) => startPanelResize("right", event)}
                />
                <aside
                  className="hidden h-full min-h-0 shrink-0 overflow-hidden border-l border-border/70 bg-card/35 lg:flex lg:flex-col"
                  style={{ width: rightPanelWidth }}
                >
                  <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-3">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Context
                    </p>
                    <button
                      type="button"
                      onClick={toggleRightPanel}
                      className="flex size-7 items-center justify-center rounded text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                      aria-label="Hide context panel"
                      title="Hide context panel"
                    >
                      <PanelRightClose className="size-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {rightPanel}
                  </div>
                </aside>
              </>
            )
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={toggleLeftPanel}
        aria-label={leftCollapsed ? "Show left panel" : "Hide left panel"}
        className="fixed bottom-3 left-3 hidden size-8 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground md:flex"
      >
        {leftCollapsed ? (
          <PanelLeftOpen className="size-4" />
        ) : (
          <PanelLeftClose className="size-4" />
        )}
      </button>

      <button
        type="button"
        onClick={() => openWorkspaceSettings("account")}
        aria-label="Settings"
        title="Settings"
        className="fixed bottom-14 left-3 hidden size-8 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground md:flex"
      >
        <Settings className="size-4" />
      </button>

      {mobilePanelOpen ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden">
          <div className="flex h-full w-[min(20rem,86vw)] flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/70 p-2">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {mobilePanelItems(isAdmin).map((item) => {
                  const Icon = item.icon;
                  const active = panelMode === item.mode;

                  return (
                    <button
                      key={item.label}
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      onClick={() => {
                        changeMode(item.mode);
                      }}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label="Close files panel"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {activePanel ?? <PlaceholderPanel mode={panelMode} />}
            </div>
          </div>
        </div>
      ) : null}

      {rightPanel && mobileRightPanelOpen ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden">
          <div className="ml-auto flex h-full w-[min(24rem,90vw)] flex-col border-l border-border/70 bg-card text-card-foreground shadow-2xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Context
              </p>
              <button
                type="button"
                onClick={() => setMobileRightPanelOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close context panel"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {rightPanel}
            </div>
          </div>
        </div>
      ) : null}

      <WorkspaceCommandPalette />
    </div>
  );
}

function mobilePanelItems(isAdmin: boolean) {
  return [
    { label: "Files", mode: "files" as const, icon: Files },
    { label: "Search", mode: "search" as const, icon: Search },
    { label: "Gallery", mode: "gallery" as const, icon: LayoutGrid },
    { label: "Assets", mode: "assets" as const, icon: ImageIcon },
    { label: "Docs", mode: "docs" as const, icon: BookOpen },
    ...(isAdmin
      ? [{ label: "Admin", mode: "admin" as const, icon: ShieldCheck }]
      : []),
  ];
}

function ResizeHandle({
  label,
  side,
  onPointerDown,
}: {
  label: string;
  side: "left" | "right";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={cn(
        "group hidden w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent transition hover:bg-primary/15 md:flex",
        side === "right" ? "lg:flex md:hidden" : null,
      )}
    >
      <GripVertical className="size-3 text-transparent transition group-hover:text-primary/80" />
    </div>
  );
}

function PlaceholderPanel({ mode }: { mode: WorkspacePanelMode }) {
  const labels: Record<WorkspacePanelMode, { title: string; body: string }> = {
    files: { title: "Files", body: "Your documents live here." },
    search: { title: "Search", body: "Global search will land here." },
    gallery: { title: "Gallery", body: "Public content browsing is next." },
    assets: { title: "Assets", body: "Uploaded images and files live here." },
    docs: { title: "Docs", body: "Official guide navigation will land here." },
    admin: { title: "Admin", body: "Moderation and docs publishing tools." },
  };
  const label = labels[mode];

  return (
    <div className="p-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label.title}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{label.body}</p>
    </div>
  );
}
