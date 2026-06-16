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
import type {
  WorkspaceDocumentItem,
  WorkspaceGuideGroup,
  WorkspacePageDescriptor,
  WorkspacePublicDocumentItem,
} from "@/components/workspace/workspace-types";

type WorkspaceChromeData = {
  profile: { role?: string | null };
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  published: WorkspaceDocumentItem[];
  publicDocuments: WorkspacePublicDocumentItem[];
  guideGroups: WorkspaceGuideGroup[];
};

type WorkspaceChromeContextValue = {
  setActivePage: (page: WorkspacePageDescriptor) => void;
  setRightPanel: (panel: ReactNode | null) => void;
};

const WorkspaceChromeContext =
  createContext<WorkspaceChromeContextValue | null>(null);

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
  const isAdmin = workspace.profile.role === "admin";

  const contextValue = useMemo(
    () => ({
      setActivePage,
      setRightPanel,
    }),
    [],
  );

  return (
    <WorkspaceChromeContext.Provider value={contextValue}>
      <VaultWorkspaceShell
        activePage={activePage}
        isAdmin={isAdmin}
        defaultPanelMode={defaultPanelModeForHref(currentHref)}
        contentClassName="max-w-none px-0 py-0 md:px-0 md:py-0"
        filePanel={
          <WorkspaceFileBrowser
            owned={workspace.owned}
            shared={workspace.shared}
            published={workspace.published}
            activeHref={currentHref.split("?")[0]}
          />
        }
        docsPanel={
          <WorkspaceDocsPanel
            docs={workspace.guideGroups}
            activeSlug={activeGuideSlugForHref(currentHref)}
          />
        }
        searchPanel={
          <WorkspaceSearchPanel
            owned={workspace.owned}
            shared={workspace.shared}
            publicDocuments={workspace.publicDocuments}
            guideGroups={workspace.guideGroups}
            activeHref={currentHref}
          />
        }
        galleryPanel={
          <WorkspaceGalleryPanel
            publicDocuments={workspace.publicDocuments}
            activeHref={currentHref}
          />
        }
        assetsPanel={<WorkspaceUtilityPanel mode="assets" activeHref={currentHref} />}
        settingsPanel={<WorkspaceUtilityPanel mode="settings" activeHref={currentHref} />}
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
}: {
  page: WorkspacePageDescriptor;
  rightPanel?: ReactNode;
}) {
  const context = useContext(WorkspaceChromeContext);

  useEffect(() => {
    context?.setActivePage(page);
    context?.setRightPanel(rightPanel ?? null);

    return () => {
      context?.setRightPanel(null);
    };
  }, [context, page, rightPanel]);

  return null;
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
    return { type: "gallery", title: "Gallery", href };
  }

  if (pathname === "/assets") {
    return { type: "assets", title: "Assets", href };
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

  if (pathname === "/dashboard/settings" || pathname === "/dashboard/friends") {
    return "settings";
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
