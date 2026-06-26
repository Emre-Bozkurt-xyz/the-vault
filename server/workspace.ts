"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  listDocumentsForUser,
  listDocumentsInOwnedFoldersFromOthers,
  listPublicDocuments,
  listSharedDocumentsForUser,
} from "@/server/documents";
import {
  listFoldersForUser,
  listSharedFoldersForUser,
} from "@/server/folders";
import { requireCompletedProfile } from "@/server/profile";
import { listPublishedOfficialDocs } from "@/server/official-docs";
import {
  parseWorkspaceLayout,
  parseWorkspaceTabs,
  workspaceLayoutCookie,
  workspaceTabsCookie,
} from "@/lib/workspace-layout";
import type {
  WorkspaceDocumentItem,
  WorkspaceFolderItem,
  WorkspaceGuideGroup,
  WorkspacePublicDocumentItem,
  WorkspaceSharedFolderItem,
} from "@/components/workspace/workspace-types";

export async function getWorkspaceData() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const cookieStore = await cookies();
  const layout = parseWorkspaceLayout(
    cookieStore.get(workspaceLayoutCookie)?.value,
  );
  const tabs = parseWorkspaceTabs(cookieStore.get(workspaceTabsCookie)?.value);
  const [
    ownedDocuments,
    foreignFolderDocuments,
    sharedDocuments,
    publicDocumentRows,
    officialDocs,
    folderRows,
    sharedFolderRows,
  ] = await Promise.all([
    listDocumentsForUser(session.user.id),
    listDocumentsInOwnedFoldersFromOthers(session.user.id),
    listSharedDocumentsForUser(session.user.id),
    listPublicDocuments({ userId: session.user.id }),
    listPublishedOfficialDocs(),
    listFoldersForUser(session.user.id),
    listSharedFoldersForUser(session.user.id),
  ]);

  const ownedDocs: WorkspaceDocumentItem[] = ownedDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    href: `/docs/${document.id}`,
    updatedAt: document.updatedAt,
    visibility: document.visibility,
    role: "owner",
    folderId: document.folderId,
  }));

  // Documents collaborators created inside the user's folders. The user can edit
  // them through folder ownership, so they appear in the folder tree alongside
  // owned documents (but are not counted as "Published", which stays personal).
  const foreignFolderDocs: WorkspaceDocumentItem[] = foreignFolderDocuments.map(
    (document) => ({
      id: document.id,
      title: document.title,
      href: `/docs/${document.id}`,
      updatedAt: document.updatedAt,
      visibility: document.visibility,
      role: "editor",
      folderId: document.folderId,
    }),
  );

  const owned: WorkspaceDocumentItem[] = [...ownedDocs, ...foreignFolderDocs];

  const folders: WorkspaceFolderItem[] = folderRows.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    sortOrder: folder.sortOrder,
  }));

  const sharedFolders: WorkspaceSharedFolderItem[] = sharedFolderRows.map(
    (folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      ownerId: folder.ownerId,
      ownerName: folder.ownerName,
      ownerUsername: folder.ownerUsername,
      role: folder.role,
    }),
  );

  const shared: WorkspaceDocumentItem[] = sharedDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    href: `/docs/${document.id}`,
    updatedAt: document.updatedAt,
    visibility: document.visibility,
    role: document.role,
    folderId: document.folderId,
    ownerId: document.ownerId,
    ownerName: document.ownerName,
    ownerUsername: document.ownerUsername,
    viaFolderName: document.viaFolderName,
  }));

  const published: WorkspaceDocumentItem[] = ownedDocs.filter(
    (document) => document.visibility === "public",
  );
  const publicDocuments: WorkspacePublicDocumentItem[] = publicDocumentRows.map(
    (document) => ({
      id: document.id,
      title: document.title,
      markdown: document.markdown,
      href: document.publicSlug
        ? `/workspace/public/${document.publicSlug}`
        : "/gallery",
      publicSlug: document.publicSlug,
      updatedAt: document.updatedAt,
      ownerName: document.ownerName,
      ownerUsername: document.ownerUsername,
      tags: document.tags,
      stats: document.stats,
    }),
  );
  const guideGroups = officialDocs.reduce<WorkspaceGuideGroup[]>((groups, doc) => {
    const existing = groups.find((group) => group.category === doc.category);
    const item = {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      category: doc.category,
      href: `/docs/guides/${doc.slug}`,
    };

    if (existing) {
      existing.docs.push(item);
      return groups;
    }

    return [...groups, { category: doc.category, docs: [item] }];
  }, []);

  return {
    profile,
    layout,
    tabs,
    owned,
    shared,
    published,
    folders,
    sharedFolders,
    publicDocuments,
    guideGroups,
    recent: [...owned, ...shared]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8),
  };
}
