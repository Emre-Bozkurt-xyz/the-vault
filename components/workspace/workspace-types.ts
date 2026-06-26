import type { LucideIcon } from "lucide-react";

export type WorkspacePageType =
  | "new"
  | "document"
  | "public"
  | "guide"
  | "gallery"
  | "assets"
  | "settings"
  | "admin";

export type WorkspacePageDescriptor = {
  type: WorkspacePageType;
  title: string;
  href: string;
};

export type WorkspaceTab = WorkspacePageDescriptor & {
  id: string;
};

/**
 * The active document's identity and capabilities, surfaced to the command
 * palette so document-scoped slash commands (publish, archive, …) know which
 * document they act on and which actions the viewer is allowed to run.
 */
export type ActiveDocumentCommandContext = {
  id: string;
  title: string;
  visibility: "private" | "public";
  publicSlug: string | null;
  canEdit: boolean;
  canShare: boolean;
  canPublish: boolean;
  canDelete: boolean;
  /** Whether the calendar/stickers extensions are enabled for this viewer. */
  calendarEnabled: boolean;
  stickersEnabled: boolean;
};

export type WorkspaceLayoutState = {
  panelMode: WorkspacePanelMode;
  leftCollapsed: boolean;
  leftWidth: number;
  rightCollapsed: boolean;
  rightWidth: number;
};

export type WorkspaceDocumentItem = {
  id: string;
  title: string;
  href: string;
  updatedAt: Date;
  visibility?: "private" | "public";
  role?: "owner" | "editor" | "viewer";
  folderId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerUsername?: string | null;
  viaFolderName?: string | null;
};

export type WorkspaceFolderItem = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

export type WorkspaceSharedFolderItem = {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  ownerName: string | null;
  ownerUsername: string | null;
  role: "editor" | "viewer";
};

export type WorkspacePublicDocumentItem = {
  id: string;
  title: string;
  markdown: string;
  href: string;
  publicSlug: string | null;
  updatedAt: Date;
  ownerName: string | null;
  ownerUsername: string | null;
  tags: string[];
  stats: {
    likeCount: number;
    viewCount: number;
    viewerHasLiked: boolean;
    score: number;
    trendingScore: number;
  };
};

export type WorkspaceGuideItem = {
  id: string;
  slug: string;
  title: string;
  category: string;
  href: string;
};

export type WorkspaceGuideGroup = {
  category: string;
  docs: WorkspaceGuideItem[];
};

export type WorkspaceNavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  mode?: WorkspacePanelMode;
  adminOnly?: boolean;
};

export type WorkspacePanelMode =
  | "files"
  | "search"
  | "gallery"
  | "assets"
  | "docs"
  | "admin";
