"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { WorkspaceDocsPanel } from "@/components/workspace/WorkspaceDocsPanel";
import { WorkspaceFileBrowser } from "@/components/workspace/WorkspaceFileBrowser";
import { WorkspaceGalleryPanel } from "@/components/workspace/WorkspaceGalleryPanel";
import { WorkspaceSearchPanel } from "@/components/workspace/WorkspaceSearchPanel";
import { WorkspaceUtilityPanel } from "@/components/workspace/WorkspaceUtilityPanel";
import { VaultWorkspaceShell } from "@/components/workspace/VaultWorkspaceShell";
import {
  subscribeToWorkspaceDocumentChanges,
  subscribeToWorkspaceDocumentRemovals,
} from "@/components/workspace/workspace-events";
import type {
  ActiveDocumentCommandContext,
  WorkspaceDocumentItem,
  WorkspaceFolderItem,
  WorkspaceGuideGroup,
  WorkspaceLayoutState,
  WorkspacePageDescriptor,
  WorkspacePublicDocumentItem,
  WorkspaceSharedFolderItem,
  WorkspaceTab,
} from "@/components/workspace/workspace-types";

type WorkspaceChromeData = {
  profile: {
    email?: string | null;
    image?: string | null;
    nickname?: string | null;
    role?: string | null;
    username?: string | null;
  };
  layout: Partial<WorkspaceLayoutState>;
  tabs: WorkspaceTab[];
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  published: WorkspaceDocumentItem[];
  folders: WorkspaceFolderItem[];
  sharedFolders: WorkspaceSharedFolderItem[];
  publicDocuments: WorkspacePublicDocumentItem[];
  guideGroups: WorkspaceGuideGroup[];
};

type WorkspaceChromeContextValue = {
  setActivePage: (page: WorkspacePageDescriptor) => void;
  setRightPanel: (panel: ReactNode | null) => void;
  upsertDocument: (document: WorkspaceDocumentItem) => void;
  activeDocument: ActiveDocumentCommandContext | null;
  setActiveDocument: (document: ActiveDocumentCommandContext | null) => void;
};

const WorkspaceChromeContext =
  createContext<WorkspaceChromeContextValue | null>(null);

/**
 * The active document's command context, or null when the foreground page is
 * not an editable document. Consumed by the command palette.
 */
export function useActiveDocumentCommand(): ActiveDocumentCommandContext | null {
  return useContext(WorkspaceChromeContext)?.activeDocument ?? null;
}

export function WorkspaceChrome({
  workspace,
  children,
}: {
  workspace: WorkspaceChromeData;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const fallbackPage = useMemo(
    () => inferWorkspacePage(currentHref, workspace),
    [currentHref, workspace],
  );
  const [activePage, setActivePage] =
    useState<WorkspacePageDescriptor>(fallbackPage);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [activeDocument, setActiveDocument] =
    useState<ActiveDocumentCommandContext | null>(null);
  const [workspaceState, setWorkspaceState] = useState(workspace);
  const isAdmin = workspace.profile.role === "admin";
  const baseCurrentHref = currentHref.split("?")[0] ?? currentHref;

  useEffect(() => {
    setWorkspaceState(workspace);
  }, [workspace]);

  const upsertDocument = useMemo(
    () => (document: WorkspaceDocumentItem) => {
      setWorkspaceState((current) => applyDocumentChange(current, {
        ...document,
        updatedAt: document.updatedAt.toISOString(),
      }));
    },
    [],
  );

  useEffect(() => {
    return subscribeToWorkspaceDocumentChanges((detail) => {
      setWorkspaceState((current) => applyDocumentChange(current, detail));

      const detailHref = detail.href?.split("?")[0];

      if (detailHref && detailHref === baseCurrentHref && detail.title) {
        setActivePage((current) => ({
          ...current,
          title: detail.title ?? current.title,
          href: current.href || detail.href || currentHref,
        }));
      }
    });
  }, [baseCurrentHref, currentHref]);

  useEffect(() => {
    return subscribeToWorkspaceDocumentRemovals(({ id }) => {
      setWorkspaceState((current) => removeDocumentFromWorkspace(current, id));
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      setActivePage,
      setRightPanel,
      upsertDocument,
      activeDocument,
      setActiveDocument,
    }),
    [upsertDocument, activeDocument],
  );

  return (
    <WorkspaceChromeContext.Provider value={contextValue}>
      <VaultWorkspaceShell
        activePage={activePage}
        isAdmin={isAdmin}
        defaultPanelMode={defaultPanelModeForHref(currentHref)}
        initialLayout={workspace.layout}
        initialTabs={workspace.tabs}
        contentClassName="max-w-none px-0 py-0 md:px-0 md:py-0"
        filePanel={
          <WorkspaceFileBrowser
            owned={workspaceState.owned}
            shared={workspaceState.shared}
            published={workspaceState.published}
            folders={workspaceState.folders}
            sharedFolders={workspaceState.sharedFolders}
            activeHref={currentHref.split("?")[0]}
          />
        }
        docsPanel={
          <WorkspaceDocsPanel
            docs={workspaceState.guideGroups}
            activeSlug={activeGuideSlugForHref(currentHref)}
          />
        }
        searchPanel={
          <WorkspaceSearchPanel
            owned={workspaceState.owned}
            shared={workspaceState.shared}
            publicDocuments={workspaceState.publicDocuments}
            guideGroups={workspaceState.guideGroups}
            activeHref={currentHref}
          />
        }
        galleryPanel={
          <WorkspaceGalleryPanel
            publicDocuments={workspaceState.publicDocuments}
            activeHref={currentHref}
          />
        }
        assetsPanel={<WorkspaceUtilityPanel mode="assets" activeHref={currentHref} />}
        adminPanel={
          <WorkspaceUtilityPanel
            mode="admin"
            activeHref={currentHref}
            isAdmin={isAdmin}
          />
        }
        rightPanel={rightPanel}
      >
        {children}
      </VaultWorkspaceShell>
    </WorkspaceChromeContext.Provider>
  );
}

export function WorkspacePageRegistration({
  page,
  rightPanel,
  documentItem,
  documentCommand,
}: {
  page: WorkspacePageDescriptor;
  rightPanel?: ReactNode;
  documentItem?: WorkspaceDocumentItem;
  documentCommand?: ActiveDocumentCommandContext;
}) {
  const context = useContext(WorkspaceChromeContext);

  useEffect(() => {
    context?.setActivePage(page);
    context?.setRightPanel(rightPanel ?? null);
    context?.setActiveDocument(documentCommand ?? null);

    if (documentItem) {
      context?.upsertDocument(documentItem);
    }

    return () => {
      context?.setRightPanel(null);
      context?.setActiveDocument(null);
    };
  }, [context, documentCommand, documentItem, page, rightPanel]);

  return null;
}

function applyDocumentChange(
  workspace: WorkspaceChromeData,
  detail: {
    id: string;
    title?: string;
    href?: string;
    updatedAt?: string;
    visibility?: "private" | "public";
    role?: "owner" | "editor" | "viewer";
  },
): WorkspaceChromeData {
  const updateList = (items: WorkspaceDocumentItem[]) => {
    let found = false;
    const nextItems = items.map((item) => {
      if (item.id !== detail.id) {
        return item;
      }

      found = true;
      return mergeDocumentItem(item, detail);
    });

    return { items: nextItems, found };
  };
  const owned = updateList(workspace.owned);
  const shared = updateList(workspace.shared);
  const shouldBeOwned = detail.role === "owner" || (!owned.found && !shared.found);
  const shouldBeShared =
    detail.role === "editor" || detail.role === "viewer" || shared.found;
  let nextOwned = owned.items;
  let nextShared = shared.items;

  if (!owned.found && !shared.found) {
    const item = createDocumentItemFromChange(detail);

    if (shouldBeShared && !shouldBeOwned) {
      nextShared = [item, ...nextShared];
    } else {
      nextOwned = [item, ...nextOwned];
    }
  }

  nextOwned = sortDocumentsByUpdatedAt(nextOwned);
  nextShared = sortDocumentsByUpdatedAt(nextShared);

  return {
    ...workspace,
    owned: nextOwned,
    shared: nextShared,
    published: nextOwned.filter(
      (document) =>
        document.visibility === "public" && document.role === "owner",
    ),
  };
}

function removeDocumentFromWorkspace(
  workspace: WorkspaceChromeData,
  documentId: string,
): WorkspaceChromeData {
  const owned = workspace.owned.filter((item) => item.id !== documentId);
  const shared = workspace.shared.filter((item) => item.id !== documentId);

  return {
    ...workspace,
    owned,
    shared,
    published: workspace.published.filter((item) => item.id !== documentId),
  };
}

function mergeDocumentItem(
  item: WorkspaceDocumentItem,
  detail: {
    title?: string;
    href?: string;
    updatedAt?: string;
    visibility?: "private" | "public";
    role?: "owner" | "editor" | "viewer";
  },
): WorkspaceDocumentItem {
  return {
    ...item,
    title: detail.title ?? item.title,
    href: detail.href ?? item.href,
    updatedAt: detail.updatedAt ? new Date(detail.updatedAt) : item.updatedAt,
    visibility: detail.visibility ?? item.visibility,
    role: detail.role ?? item.role,
  };
}

function createDocumentItemFromChange(detail: {
  id: string;
  title?: string;
  href?: string;
  updatedAt?: string;
  visibility?: "private" | "public";
  role?: "owner" | "editor" | "viewer";
}): WorkspaceDocumentItem {
  return {
    id: detail.id,
    title: detail.title?.trim() || "Untitled document",
    href: detail.href ?? `/docs/${detail.id}`,
    updatedAt: detail.updatedAt ? new Date(detail.updatedAt) : new Date(),
    visibility: detail.visibility ?? "private",
    role: detail.role ?? "owner",
  };
}

function sortDocumentsByUpdatedAt(items: WorkspaceDocumentItem[]) {
  return [...items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

function inferWorkspacePage(
  href: string,
  workspace: WorkspaceChromeData,
): WorkspacePageDescriptor {
  const pathname = href.split("?")[0] ?? href;
  const document = [...workspace.owned, ...workspace.shared].find(
    (item) => item.href === pathname,
  );
  const publicDocument = workspace.publicDocuments.find(
    (item) => item.href === pathname,
  );

  if (document) {
    return {
      type: "document",
      title: document.title,
      href,
    };
  }

  if (publicDocument) {
    return {
      type: "public",
      title: publicDocument.title,
      href,
    };
  }

  if (pathname === "/workspace") {
    return { type: "new", title: "New tab", href };
  }

  if (pathname === "/gallery") {
    return { type: "gallery", title: "Gallery", href: pathname };
  }

  if (pathname === "/assets") {
    return { type: "assets", title: "Assets", href: pathname };
  }

  if (pathname === "/dashboard/settings") {
    return { type: "settings", title: "Settings", href };
  }

  if (pathname === "/dashboard/friends") {
    return { type: "settings", title: "Friends", href };
  }

  if (pathname === "/dashboard/admin") {
    return { type: "admin", title: "Admin", href };
  }

  if (pathname === "/dashboard/admin/docs") {
    return { type: "admin", title: "Official docs", href };
  }

  if (pathname === "/dashboard/admin/tags") {
    return { type: "admin", title: "Tags", href };
  }

  if (pathname?.startsWith("/dashboard/admin/docs/")) {
    return { type: "admin", title: "Edit official doc", href };
  }

  return { type: "new", title: "Vault", href };
}

function defaultPanelModeForHref(href: string) {
  const pathname = href.split("?")[0] ?? href;

  if (pathname.startsWith("/dashboard/admin")) {
    return "admin";
  }

  if (pathname === "/gallery") {
    return "gallery";
  }

  if (pathname === "/assets") {
    return "assets";
  }

  if (pathname.startsWith("/workspace/public/")) {
    return "gallery";
  }

  if (pathname === "/docs" || pathname.startsWith("/docs/guides/")) {
    return "docs";
  }

  return "files";
}

function activeGuideSlugForHref(href: string) {
  const pathname = href.split("?")[0] ?? href;
  const prefix = "/docs/guides/";

  return pathname.startsWith(prefix)
    ? decodeURIComponent(pathname.slice(prefix.length))
    : undefined;
}
