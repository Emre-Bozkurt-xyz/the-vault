/**
 * Data access for `@/server/documents`, for callers that have already
 * authenticated the user.
 *
 * These functions take a `userId` and trust it. They live here, in a module with
 * **no** `"use server"` directive, because every export of such a module is
 * registered as a callable server action — and as endpoints their only protection
 * would be that no client bundle happens to contain their action id. Never add the
 * directive to this file, and never accept a user id in an action.
 */

import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  documentCollabStates,
  documentPermissions,
  documentShareLinks,
  documentTags,
  documentVersions,
  documents,
  folderPermissions,
  folders,
  tags,
  users,
  type DocumentRole,
  type DocumentVisibility,
} from "@/db/schema";
import {
  canDeleteDocument,
  canEditDocument,
  canShareDocument,
  type DocumentAccess,
  getDocumentAccess,
} from "@/lib/permissions";
import { coerceDates } from "@/lib/db-rows";
import { definitionTagSlug } from "@/lib/definitions";
import { pruneAssistantVersions } from "@/lib/document-versions";
import { buildWikiLinkResolutionMap } from "@/lib/wiki-links";
import { reconcileDocumentAssetLinks } from "@/server/assets";
import { syncDocumentMetadata } from "@/server/content-metadata";

export async function createDocumentForUser(
  userId: string,
  input: { title?: string; markdown?: string } = {},
): Promise<{ id: string }> {
  const title = (input.title?.trim() || "Untitled document").slice(0, 200);
  // The title is stored/rendered separately, so a seeded "# Untitled document /
  // Start writing..." body just duplicates the title (and mismatches when a title
  // was given). Start agent-created docs with an empty body instead.
  const markdown = input.markdown ?? "";

  const [document] = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({ ownerId: userId, title, markdown })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId,
      role: "owner",
    });

    return [createdDocument];
  });

  if (input.markdown !== undefined) {
    await reconcileDocumentAssetLinks({ documentId: document.id, markdown });
    await syncDocumentMetadata({ documentId: document.id, markdown });
  }

  return { id: document.id };
}

export async function archiveDocumentForUser(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return false;
  }

  if (!(await canDeleteDocument(userId, parsedDocumentId.data))) {
    return false;
  }

  let archived = false;

  await db.transaction(async (tx) => {
    const [document] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(
        and(eq(documents.id, parsedDocumentId.data), isNull(documents.deletedAt)),
      )
      .limit(1);

    if (!document) {
      return;
    }

    await createDocumentVersion(tx, {
      document,
      actorId: userId,
      reason: "before_archive",
    });

    await tx
      .update(documents)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(documents.id, parsedDocumentId.data), isNull(documents.deletedAt)),
      );

    archived = true;
  });

  return archived;
}

export async function setDocumentTitleForUser(
  userId: string,
  documentId: string,
  title: string,
): Promise<boolean> {
  const parsedId = documentIdSchema.safeParse(documentId);
  const nextTitle = title.trim().slice(0, 200);

  if (!parsedId.success || nextTitle.length === 0) {
    return false;
  }

  if (!(await canEditDocument(userId, parsedId.data))) {
    return false;
  }

  let updated = false;

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, parsedId.data), isNull(documents.deletedAt)))
      .limit(1);

    if (!current) {
      return;
    }

    // Force a restore point per agent operation (unlike the gated UI path).
    if (current.title !== nextTitle) {
      await createDocumentVersion(tx, {
        document: current,
        actorId: userId,
        reason: "assistant",
      });
      await pruneAssistantVersions(tx, parsedId.data);

      await tx
        .update(documents)
        .set({ title: nextTitle, updatedAt: sql`now()` })
        .where(and(eq(documents.id, parsedId.data), isNull(documents.deletedAt)));
    }

    updated = true;
  });

  return updated;
}

export async function getDocumentVersionForUser(
  userId: string,
  documentId: string,
  versionId: string,
) {
  const parsedId = documentIdSchema.safeParse(documentId);
  const parsedVersion = documentIdSchema.safeParse(versionId);

  if (!parsedId.success || !parsedVersion.success) {
    return null;
  }

  if (!(await canEditDocument(userId, parsedId.data))) {
    return null;
  }

  const [version] = await db
    .select({
      id: documentVersions.id,
      title: documentVersions.title,
      markdown: documentVersions.markdown,
      reason: documentVersions.reason,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, parsedVersion.data),
        eq(documentVersions.documentId, parsedId.data),
      ),
    )
    .limit(1);

  return version ?? null;
}

export async function restoreDocumentVersionForUser(
  userId: string,
  documentId: string,
  versionId: string,
): Promise<boolean> {
  const parsedId = documentIdSchema.safeParse(documentId);
  const parsedVersion = documentIdSchema.safeParse(versionId);

  if (!parsedId.success || !parsedVersion.success) {
    return false;
  }

  if (!(await canEditDocument(userId, parsedId.data))) {
    return false;
  }

  let restoredMarkdown: string | null = null;

  await db.transaction(async (tx) => {
    const [version] = await tx
      .select({
        title: documentVersions.title,
        markdown: documentVersions.markdown,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, parsedVersion.data),
          eq(documentVersions.documentId, parsedId.data),
        ),
      )
      .limit(1);

    const [current] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, parsedId.data), isNull(documents.deletedAt)))
      .limit(1);

    if (!version || !current) {
      return;
    }

    await createDocumentVersion(tx, {
      document: current,
      actorId: userId,
      reason: "before_restore",
    });

    await tx
      .update(documents)
      .set({
        title: version.title,
        markdown: version.markdown,
        updatedAt: sql`now()`,
      })
      .where(and(eq(documents.id, parsedId.data), isNull(documents.deletedAt)));

    await tx
      .delete(documentCollabStates)
      .where(eq(documentCollabStates.documentId, parsedId.data));

    restoredMarkdown = version.markdown;
  });

  if (restoredMarkdown === null) {
    return false;
  }

  await reconcileDocumentAssetLinks({
    documentId: parsedId.data,
    markdown: restoredMarkdown,
  });
  await syncDocumentMetadata({
    documentId: parsedId.data,
    markdown: restoredMarkdown,
  });

  return true;
}

export async function restoreArchivedDocumentForUser(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const parsedId = documentIdSchema.safeParse(documentId);

  if (!parsedId.success) {
    return false;
  }

  const [document] = await db
    .select({ ownerId: documents.ownerId, deletedAt: documents.deletedAt })
    .from(documents)
    .where(eq(documents.id, parsedId.data))
    .limit(1);

  if (!document || document.ownerId !== userId || !document.deletedAt) {
    return false;
  }

  await db
    .update(documents)
    .set({ deletedAt: null, updatedAt: sql`now()` })
    .where(eq(documents.id, parsedId.data));

  return true;
}

export async function purgeExpiredArchivedDocumentsForUser(
  userId: string,
  retentionDays: number | null,
): Promise<void> {
  if (retentionDays == null) {
    return;
  }

  await db
    .delete(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        isNotNull(documents.deletedAt),
        sql`${documents.deletedAt} < now() - make_interval(days => ${retentionDays})`,
      ),
    );
}

export async function listArchivedDocumentsForUser(userId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), isNotNull(documents.deletedAt)))
    .orderBy(desc(documents.deletedAt));
}

export async function listDocumentsForUser(userId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      folderId: documents.folderId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.updatedAt));
}

export async function listDocumentsInOwnedFoldersFromOthers(userId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      visibility: documents.visibility,
      folderId: documents.folderId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(folders, eq(documents.folderId, folders.id))
    .where(
      and(
        eq(folders.ownerId, userId),
        ne(documents.ownerId, userId),
        isNull(documents.deletedAt),
        isNull(folders.deletedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt));
}

export async function listSharedDocumentsForUser(
  userId: string,
): Promise<SharedDocumentRow[]> {
  const directRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      updatedAt: documents.updatedAt,
      role: documentPermissions.role,
      folderId: documents.folderId,
      ownerId: documents.ownerId,
      ownerName: users.name,
      ownerUsername: users.username,
    })
    .from(documentPermissions)
    .innerJoin(documents, eq(documentPermissions.documentId, documents.id))
    .innerJoin(users, eq(documents.ownerId, users.id))
    .where(
      and(
        eq(documentPermissions.userId, userId),
        ne(documentPermissions.role, "owner"),
        isNull(documents.deletedAt),
      ),
    );

  const inheritedRows = await db.execute<{
    id: string;
    title: string;
    markdown: string;
    visibility: DocumentVisibility;
    updatedAt: Date;
    role: "editor" | "viewer";
    folderId: string | null;
    ownerId: string;
    ownerName: string | null;
    ownerUsername: string | null;
    viaFolderName: string | null;
  }>(sql`
    with recursive shared_folders as (
      select f.id, fp.role::text as role, f.name as via_name
      from ${folders} f
      join ${folderPermissions} fp
        on fp.folder_id = f.id and fp.user_id = ${userId}
      where f.deleted_at is null
      union all
      select c.id, sf.role, sf.via_name
      from ${folders} c
      join shared_folders sf on c.parent_id = sf.id
      where c.deleted_at is null
    )
    select
      d.id as "id",
      d.title as "title",
      d.markdown as "markdown",
      d.visibility as "visibility",
      d.updated_at as "updatedAt",
      sf.role as "role",
      d.folder_id as "folderId",
      d.owner_id as "ownerId",
      u.name as "ownerName",
      u.username as "ownerUsername",
      sf.via_name as "viaFolderName"
    from shared_folders sf
    join ${documents} d on d.folder_id = sf.id
    join ${users} u on u.id = d.owner_id
    where d.deleted_at is null and d.owner_id <> ${userId}
  `);

  const byId = new Map<string, SharedDocumentRow>();

  for (const row of directRows) {
    byId.set(row.id, { ...row, viaFolderName: null });
  }

  for (const row of inheritedRows) {
    const existing = byId.get(row.id);

    // A direct share is authoritative; otherwise keep the strongest folder role.
    // Raw db.execute rows skip Drizzle's column mapping, so coerce the timestamp
    // back to a Date to match the query-builder rows.
    if (!existing) {
      byId.set(row.id, coerceDates(row, ["updatedAt"]));
    } else if (existing.viaFolderName && row.role === "editor") {
      byId.set(row.id, { ...existing, role: "editor" });
    }
  }

  return [...byId.values()].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

export async function listWikiLinkResolutionsForUser(
  userId: string,
  options: { includeEmbeds?: boolean } = {},
) {
  const definitionDocumentIds = await listDefinitionDocumentIds();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
      ownerId: documents.ownerId,
      sharedUserId: documentPermissions.userId,
      ownerUsername: users.username,
    })
    .from(documents)
    .innerJoin(users, eq(documents.ownerId, users.id))
    .leftJoin(
      documentPermissions,
      and(
        eq(documents.id, documentPermissions.documentId),
        eq(documentPermissions.userId, userId),
      ),
    )
    .where(
      and(
        isNull(documents.deletedAt),
        or(
          eq(documents.ownerId, userId),
          eq(documentPermissions.userId, userId),
          eq(documents.visibility, "public"),
        ),
      ),
    )
    .orderBy(documents.title);

  return buildWikiLinkResolutionMap(
    rows,
    (document) => `/docs/${document.id}`,
    {
      includeEmbeds: options.includeEmbeds ?? true,
      includePublicKeys: true,
      definitionDocumentIds,
      sourceForDocument: (document) =>
        document.ownerId === userId || document.sharedUserId === userId
          ? "document"
          : document.visibility === "public"
            ? "public"
            : "document",
    },
  );
}

export async function listDocumentCollaborators(documentId: string, userId: string) {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return [];
  }

  const allowed = await canShareDocument(userId, parsedDocumentId.data);

  if (!allowed) {
    return [];
  }

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: documentPermissions.role,
    })
    .from(documentPermissions)
    .innerJoin(users, eq(documentPermissions.userId, users.id))
    .where(eq(documentPermissions.documentId, parsedDocumentId.data))
    .orderBy(documentPermissions.role, users.email);
}

export async function listDocumentFolderCollaborators(
  documentId: string,
  userId: string,
) {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return [];
  }

  if (!(await canShareDocument(userId, parsedDocumentId.data))) {
    return [];
  }

  return db.execute<{
    userId: string;
    name: string | null;
    email: string | null;
    role: "editor" | "viewer";
    folderName: string;
  }>(sql`
    with recursive chain as (
      select f.id, f.parent_id, f.name
      from ${folders} f
      where f.id = (
        select folder_id from ${documents} where id = ${parsedDocumentId.data}
      )
      and f.deleted_at is null
      union all
      select f.id, f.parent_id, f.name
      from ${folders} f
      join chain c on f.id = c.parent_id
      where f.deleted_at is null
    )
    select
      u.id as "userId",
      u.name as "name",
      u.email as "email",
      fp.role as "role",
      c.name as "folderName"
    from chain c
    join ${folderPermissions} fp on fp.folder_id = c.id
    join ${users} u on u.id = fp.user_id
    where u.id <> ${userId}
    order by u.email
  `);
}

export async function getActiveDocumentShareLinkForUser(
  documentId: string,
  userId: string,
) {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return null;
  }

  const allowed = await canShareDocument(userId, parsedDocumentId.data);

  if (!allowed) {
    return null;
  }

  const [link] = await db
    .select({
      id: documentShareLinks.id,
      scope: documentShareLinks.scope,
      role: documentShareLinks.role,
      expiresAt: documentShareLinks.expiresAt,
      createdAt: documentShareLinks.createdAt,
    })
    .from(documentShareLinks)
    .where(
      and(
        eq(documentShareLinks.documentId, parsedDocumentId.data),
        eq(documentShareLinks.enabled, 1),
        or(
          isNull(documentShareLinks.expiresAt),
          sql`${documentShareLinks.expiresAt} > now()`,
        ),
      ),
    )
    .orderBy(desc(documentShareLinks.createdAt))
    .limit(1);

  return link ?? null;
}

export async function getDocumentByShareLink(
  linkId: string,
  userId: string | null,
) {
  const parsedLinkId = shareLinkIdSchema.safeParse(linkId);

  if (!parsedLinkId.success) {
    return null;
  }

  const [row] = await db
    .select({
      linkId: documentShareLinks.id,
      scope: documentShareLinks.scope,
      linkRole: documentShareLinks.role,
      documentId: documents.id,
      ownerId: documents.ownerId,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
      folderId: documents.folderId,
      updatedAt: documents.updatedAt,
    })
    .from(documentShareLinks)
    .innerJoin(documents, eq(documentShareLinks.documentId, documents.id))
    .where(
      and(
        eq(documentShareLinks.id, parsedLinkId.data),
        eq(documentShareLinks.enabled, 1),
        isNull(documents.deletedAt),
        or(
          isNull(documentShareLinks.expiresAt),
          sql`${documentShareLinks.expiresAt} > now()`,
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const regularAccess = userId
    ? await getDocumentAccess(userId, row.documentId)
    : await getDocumentAccess(null, row.documentId);
  const linkAllowsMember = Boolean(userId) && row.scope === "members";
  const linkAllowsAnonymousRead =
    (row.scope === "anyone" && row.linkRole === "viewer") ||
    row.linkRole === "editor";
  const linkCanRead =
    linkAllowsAnonymousRead || linkAllowsMember || regularAccess.canRead;
  const linkCanEdit =
    row.linkRole === "editor" && linkAllowsMember && Boolean(userId);

  if (!linkCanRead) {
    return {
      requiresSignIn: row.scope === "members",
      document: null,
    } as const;
  }

  const access = mergeShareLinkAccess(regularAccess, {
    canRead: linkCanRead,
    canEdit: linkCanEdit,
  });

  return {
    requiresSignIn: false,
    document: {
      id: row.documentId,
      title: row.title,
      markdown: row.markdown,
      visibility: row.visibility,
      publicSlug: row.publicSlug,
      folderId: row.folderId,
      updatedAt: row.updatedAt,
      access,
    },
  } as const;
}

export async function canEditDocumentWithOptionalShareLink(
  userId: string,
  documentId: string,
  shareLinkId?: string | null,
) {
  if (await canEditDocument(userId, documentId)) {
    return true;
  }

  if (!shareLinkId) {
    return false;
  }

  const shared = await getDocumentByShareLink(shareLinkId, userId);
  return Boolean(
    shared?.document?.id === documentId && shared.document.access.canEdit,
  );
}

export async function listDocumentVersionsForUser(
  documentId: string,
  userId: string,
) {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return [];
  }

  const allowed = await canEditDocument(userId, parsedDocumentId.data);

  if (!allowed) {
    return [];
  }

  return db
    .select({
      id: documentVersions.id,
      title: documentVersions.title,
      markdownPreview: sql<string>`left(${documentVersions.markdown}, 240)`,
      markdownLength: sql<number>`char_length(${documentVersions.markdown})`,
      reason: documentVersions.reason,
      createdAt: documentVersions.createdAt,
      createdByName: users.name,
      createdByEmail: users.email,
    })
    .from(documentVersions)
    .leftJoin(users, eq(documentVersions.createdBy, users.id))
    .where(eq(documentVersions.documentId, parsedDocumentId.data))
    .orderBy(desc(documentVersions.createdAt))
    .limit(12);
}

export async function getDocumentForUser(userId: string, documentId: string) {
  const parsedDocumentId = documentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    return null;
  }

  const access = await getDocumentAccess(userId, parsedDocumentId.data);

  if (!access.canRead) {
    return null;
  }

  const [document] = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
      folderId: documents.folderId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.id, parsedDocumentId.data), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return null;
  }

  return {
    ...document,
    access,
  };
}

export async function getDocumentForUserWithOptionalShareLink(
  userId: string,
  documentId: string,
  shareLinkId?: string | null,
) {
  const document = await getDocumentForUser(userId, documentId);

  if (!shareLinkId) {
    return document;
  }

  const shared = await getDocumentByShareLink(shareLinkId, userId);

  if (!shared?.document) {
    return document;
  }

  if (!document) {
    return shared.document;
  }

  return shared.document.access.canEdit && !document.access.canEdit
    ? shared.document
    : document;
}

export const documentIdSchema = z.string().uuid();

const shareLinkIdSchema = z.string().uuid();

function mergeShareLinkAccess(
  regularAccess: DocumentAccess,
  linkAccess: { canRead: boolean; canEdit: boolean },
): DocumentAccess {
  if (regularAccess.role === "owner") {
    return regularAccess;
  }

  const canEdit = regularAccess.canEdit || linkAccess.canEdit;
  const canRead = regularAccess.canRead || linkAccess.canRead || canEdit;

  return {
    canRead,
    canEdit,
    canShare: regularAccess.canShare,
    canDelete: regularAccess.canDelete,
    canPublish: regularAccess.canPublish,
    role: canEdit ? "editor" : regularAccess.role ?? (canRead ? "viewer" : null),
  };
}

export async function listDefinitionDocumentIds() {
  const rows = await db
    .select({ documentId: documentTags.documentId })
    .from(documentTags)
    .innerJoin(tags, eq(documentTags.tagId, tags.id))
    .where(eq(tags.slug, definitionTagSlug));

  return new Set(rows.map((row) => row.documentId));
}

type SharedDocumentRow = {
  id: string;
  title: string;
  markdown: string;
  visibility: DocumentVisibility;
  updatedAt: Date;
  role: DocumentRole;
  folderId: string | null;
  ownerId: string;
  ownerName: string | null;
  ownerUsername: string | null;
  viaFolderName: string | null;
};

export async function createDocumentVersion(
  tx: DocumentVersionExecutor,
  {
    document,
    actorId,
    reason,
  }: {
    document: VersionableDocument;
    actorId: string | null;
    reason: string;
  },
) {
  await tx.insert(documentVersions).values({
    documentId: document.id,
    createdBy: actorId,
    title: document.title,
    markdown: document.markdown,
    reason,
  });
}

export type DocumentVersionExecutor = Pick<typeof db, "select" | "insert">;

export type VersionableDocument = {
  id: string;
  title: string;
  markdown: string;
};
