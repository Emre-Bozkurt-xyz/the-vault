import type { LucideIcon } from "lucide-react";

export type WorkspacePageType =
  | "new"
  | "document"
  | "public"
  | "guide"
  | "gallery"
  | "settings"
  | "admin";

export type WorkspacePageDescriptor = {
  type: WorkspacePageType;
  title: string;
  href: string;
};

export type WorkspaceDocumentItem = {
  id: string;
  title: string;
  href: string;
  updatedAt: Date;
  visibility?: "private" | "public";
  role?: "owner" | "editor" | "viewer";
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

export type WorkspacePanelMode = "files" | "search" | "gallery" | "docs" | "settings" | "admin";
