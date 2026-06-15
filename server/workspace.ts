"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  listDocumentsForUser,
  listPublicDocuments,
  listSharedDocumentsForUser,
} from "@/server/documents";
import { requireCompletedProfile } from "@/server/profile";
import { listPublishedOfficialDocs } from "@/server/official-docs";
import type {
  WorkspaceDocumentItem,
  WorkspaceGuideGroup,
  WorkspacePublicDocumentItem,
} from "@/components/workspace/workspace-types";

export async function getWorkspaceData() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const [ownedDocuments, sharedDocuments, publicDocumentRows, officialDocs] =
    await Promise.all([
      listDocumentsForUser(session.user.id),
      listSharedDocumentsForUser(session.user.id),
      listPublicDocuments(),
      listPublishedOfficialDocs(),
    ]);

  const owned: WorkspaceDocumentItem[] = ownedDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    href: `/docs/${document.id}`,
    updatedAt: document.updatedAt,
    visibility: document.visibility,
    role: "owner",
  }));

  const shared: WorkspaceDocumentItem[] = sharedDocuments.map((document) => ({
    id: document.id,
    title: document.title,
    href: `/docs/${document.id}`,
    updatedAt: document.updatedAt,
    visibility: document.visibility,
    role: document.role,
  }));

  const published: WorkspaceDocumentItem[] = owned.filter(
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
    owned,
    shared,
    published,
    publicDocuments,
    guideGroups,
    recent: [...owned, ...shared]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8),
  };
}
