"use server";

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  documentCollabStates,
  documentMetadata,
  documentPermissions,
  documentShareLinks,
  documentTags,
  documentVersions,
  documents,
  friendships,
  tags,
  users,
} from "@/db/schema";
import {
  canEditDocument,
  canEditFolderContents,
  canShareDocument,
  getDocumentAccess,
} from "@/lib/permissions";
import { maxMarkdownLength } from "@/lib/markdown";
import {
  type ContentSearchQuery,
  contentSearchIsEmpty,
} from "@/lib/content-search-query";
import { normalizeTagSlug } from "@/lib/content-metadata";
import { slugify } from "@/lib/slug";
import { buildWikiLinkResolutionMap } from "@/lib/wiki-links";
import { requireActiveUser } from "@/server/authz";
import { reconcileDocumentAssetLinks } from "@/server/assets";
import { syncDocumentMetadata } from "@/server/content-metadata";
import { getDocumentContentStats } from "@/server/content-interactions";
import {
  DocumentVersionExecutor,
  VersionableDocument,
  archiveDocumentForUser,
  canEditDocumentWithOptionalShareLink,
  createDocumentVersion,
  documentIdSchema,
  listDefinitionDocumentIds,
  restoreArchivedDocumentForUser,
} from "@/server/documents-data";

const initialMarkdownContent = "# Untitled document\n\nStart writing...\n";
const automaticVersionIntervalMs = 10 * 60 * 1000;
const significantVersionAbsoluteDiff = 2_000;
const significantVersionRelativeDiff = 0.25;

const saveMarkdownDocumentSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
  markdown: z.string().max(maxMarkdownLength),
  shareLinkId: z.string().uuid().optional().nullable(),
});

const saveDocumentTitleSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
  shareLinkId: z.string().uuid().optional().nullable(),
});

const shareDocumentSchema = z.object({
  documentId: documentIdSchema,
  userId: z.string().uuid().optional().or(z.literal("")),
  query: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(["viewer", "editor"]),
});

const shareFriendDocumentSchema = z.object({
  documentId: documentIdSchema,
  userId: z.string().uuid(),
  role: z.enum(["viewer", "editor"]),
});

const collaboratorMutationSchema = z.object({
  documentId: documentIdSchema,
  userId: z.string().uuid(),
});

const publishMutationSchema = z.object({
  documentId: documentIdSchema,
});

const restoreDocumentVersionSchema = z.object({
  documentId: documentIdSchema,
  versionId: z.string().uuid(),
});

const updateCollaboratorRoleSchema = collaboratorMutationSchema.extend({
  role: z.enum(["viewer", "editor"]),
});
const updateShareLinkSchema = z.object({
  documentId: documentIdSchema,
  mode: z.enum(["off", "anyone-viewer", "members-viewer", "members-editor"]),
});

function normalizeFriendPair(userA: string, userB: string) {
  return userA < userB
    ? { userLowId: userA, userHighId: userB }
    : { userLowId: userB, userHighId: userA };
}

export async function createDocumentAction() {
  const user = await requireActiveUser();

  const [document] = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        ownerId: user.id,
        title: "Untitled document",
        markdown: initialMarkdownContent,
      })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId: user.id,
      role: "owner",
    });

    return [createdDocument];
  });

  redirect(`/docs/${document.id}`);
}

export async function createDocumentInFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const rawFolderId = formData.get("folderId");
  const folderId =
    typeof rawFolderId === "string" && rawFolderId
      ? documentIdSchema.parse(rawFolderId)
      : null;

  // Allow creating into any folder the user can manage: their own, or one
  // shared with them as an editor. The new document is owned by its creator.
  if (folderId && !(await canEditFolderContents(user.id, folderId))) {
    notFound();
  }

  const [document] = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        ownerId: user.id,
        folderId,
        title: "Untitled document",
        markdown: initialMarkdownContent,
      })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId: user.id,
      role: "owner",
    });

    return [createdDocument];
  });

  // Refresh the workspace layout so the sidebar tree places the new document in
  // its folder; the redirect navigation alone keeps the cached (stale) layout.
  revalidatePath("/", "layout");
  redirect(`/docs/${document.id}`);
}

/**
 * Creates a document owned by `userId` and returns its id. Unlike
 * {@link createDocumentAction} (which redirects), this is callable from
 * non-UI contexts such as the MCP server. When `markdown` is supplied, asset
 * links and frontmatter metadata are reconciled the same way a save would.
 */

export async function saveMarkdownDocumentAction(
  input: unknown,
): Promise<
  | { ok: true; updatedAt: string }
  | { ok: false; message: string }
> {
  const user = await requireActiveUser();

  const parsed = saveMarkdownDocumentSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "This Markdown document is too large or has an invalid title.",
    };
  }

  const allowed = await canEditDocumentWithOptionalShareLink(
    user.id,
    parsed.data.documentId,
    parsed.data.shareLinkId,
  );

  if (!allowed) {
    notFound();
  }

  return saveMarkdownDocumentCore({
    documentId: parsed.data.documentId,
    title: parsed.data.title,
    markdown: parsed.data.markdown,
    actorId: user.id,
  });
}

export async function saveDocumentTitleAction(
  input: unknown,
): Promise<
  | { ok: true; updatedAt: string }
  | { ok: false; message: string }
> {
  const user = await requireActiveUser();

  const parsed = saveDocumentTitleSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the title and try saving again.",
    };
  }

  const allowed = await canEditDocumentWithOptionalShareLink(
    user.id,
    parsed.data.documentId,
    parsed.data.shareLinkId,
  );

  if (!allowed) {
    notFound();
  }

  return saveDocumentTitleCore({
    documentId: parsed.data.documentId,
    title: parsed.data.title,
    actorId: user.id,
  });
}

/**
 * Post-authentication core of {@link saveMarkdownDocumentAction}: updates a
 * document's title + Markdown body, snapshotting a version when the diff is
 * significant, and drops any live collab state so the next load re-derives
 * the Y.Doc from the newly saved Markdown. Callers MUST already have checked
 * edit access (`canEditDocumentWithOptionalShareLink`/`getDocumentAccess`) —
 * this performs no permission check itself. Shared by the session-cookie
 * server action above and `POST /api/embed/documents/[id]/content`
 * (docs/DEN_EMBED_BRIDGE.md), which authenticates via a bearer embed session
 * token instead of the Vault session cookie.
 */
export async function saveMarkdownDocumentCore(input: {
  documentId: string;
  title: string;
  markdown: string;
  actorId: string;
}): Promise<{ ok: true; updatedAt: string }> {
  await db.transaction(async (tx) => {
    const [currentDocument] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!currentDocument) {
      notFound();
    }

    await maybeCreateAutomaticDocumentVersion(tx, {
      document: currentDocument,
      actorId: input.actorId,
      reason: "auto",
      nextTitle: input.title,
      nextMarkdown: input.markdown,
    });

    await tx
      .update(documents)
      .set({
        title: input.title,
        markdown: input.markdown,
        updatedAt: sql`now()`,
      })
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));

    await tx
      .delete(documentCollabStates)
      .where(eq(documentCollabStates.documentId, input.documentId));
  });
  await reconcileDocumentAssetLinks({
    documentId: input.documentId,
    markdown: input.markdown,
  });
  await syncDocumentMetadata({
    documentId: input.documentId,
    markdown: input.markdown,
  });

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Post-authentication core of {@link saveDocumentTitleAction} — the
 * title-only save used while a collab room is live (the Markdown body is
 * owned by the Y.Doc in that case, so only the `documents.title` column
 * needs a plain write). Same caller contract as
 * {@link saveMarkdownDocumentCore}: no permission check here, edit access
 * must already be verified.
 */
export async function saveDocumentTitleCore(input: {
  documentId: string;
  title: string;
  actorId: string;
}): Promise<{ ok: true; updatedAt: string }> {
  await db.transaction(async (tx) => {
    const [currentDocument] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!currentDocument) {
      notFound();
    }

    await maybeCreateAutomaticDocumentVersion(tx, {
      document: currentDocument,
      actorId: input.actorId,
      reason: "auto",
      nextTitle: input.title,
      nextMarkdown: currentDocument.markdown,
    });

    await tx
      .update(documents)
      .set({
        title: input.title,
        updatedAt: sql`now()`,
      })
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));
  });

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function createManualDocumentVersionAction(formData: FormData) {
  const user = await requireActiveUser();

  const documentId = documentIdSchema.parse(formData.get("documentId"));
  const allowed = await canEditDocument(user.id, documentId);

  if (!allowed) {
    notFound();
  }

  await db.transaction(async (tx) => {
    const [document] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!document) {
      notFound();
    }

    await createDocumentVersion(tx, {
      document,
      actorId: user.id,
      reason: "manual",
    });
  });

  redirect(`/docs/${documentId}`);
}

export async function restoreDocumentVersionAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = restoreDocumentVersionSchema.parse({
    documentId: formData.get("documentId"),
    versionId: formData.get("versionId"),
  });
  const allowed = await canEditDocument(user.id, input.documentId);

  if (!allowed) {
    notFound();
  }

  let restoredMarkdown = "";

  await db.transaction(async (tx) => {
    const [version] = await tx
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        title: documentVersions.title,
        markdown: documentVersions.markdown,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, input.versionId),
          eq(documentVersions.documentId, input.documentId),
        ),
      )
      .limit(1);

    const [currentDocument] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
      .limit(1);

    if (!version || !currentDocument) {
      notFound();
    }

    restoredMarkdown = version.markdown;

    await createDocumentVersion(tx, {
      document: currentDocument,
      actorId: user.id,
      reason: "before_restore",
    });

    await tx
      .update(documents)
      .set({
        title: version.title,
        markdown: version.markdown,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(documents.id, input.documentId), isNull(documents.deletedAt)),
      );

    await tx
      .delete(documentCollabStates)
      .where(eq(documentCollabStates.documentId, input.documentId));
  });
  await reconcileDocumentAssetLinks({
    documentId: input.documentId,
    markdown: restoredMarkdown,
  });
  await syncDocumentMetadata({
    documentId: input.documentId,
    markdown: restoredMarkdown,
  });

  redirect(`/docs/${input.documentId}`);
}

/**
 * Archives (soft-deletes) a document the current user can delete. Redirect-free
 * and result-returning so it can be invoked from client code inside the
 * workspace SPA — the caller dispatches {@link dispatchWorkspaceDocumentRemoved}
 * on success to close the tab and drop it from the sidebar. (A hard redirect
 * here would race that client navigation and re-render the now-archived doc
 * route into `notFound`.) Delegates the version snapshot + soft delete to
 * {@link archiveDocumentForUser}.
 */
export async function archiveDocumentAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await requireActiveUser();

  const parsed = documentIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "This document reference is invalid." };
  }

  const archived = await archiveDocumentForUser(user.id, parsed.data);

  return archived
    ? { ok: true }
    : { ok: false, message: "This document could not be archived." };
}

/**
 * Archives (soft-deletes) a document on behalf of `userId`, snapshotting a
 * version first. Returns false when the document is missing or the user lacks
 * delete permission. Like {@link createDocumentForUser}, this is the redirect-free
 * variant of {@link archiveDocumentAction} for non-UI callers (e.g. MCP). The
 * delete is recoverable from the document's version history / trash.
 */

/**
 * Updates a document's title (a `documents` column, separate from the collab
 * body) on behalf of `userId`, snapshotting a version first. Redirect-free
 * sibling of {@link saveDocumentTitleAction} for non-UI callers (MCP). Returns
 * false when the document is missing or the user lacks edit access.
 */

/**
 * Returns a single prior version's full content for a document the user can
 * edit, or null. Edit-gated to match {@link listDocumentVersionsForUser}.
 */

/**
 * Restores a document to a prior version on behalf of `userId` (redirect-free
 * {@link restoreDocumentVersionAction}). Snapshots the current state as a
 * `before_restore` version, then resets title/markdown and clears collab state
 * so the next load rebuilds from the restored markdown. Returns false when the
 * version or document is missing or the user lacks edit access.
 */

/**
 * Un-archives a previously soft-deleted document. Owner-only. Returns false when
 * the document is missing, not deleted, or not owned by the user.
 */

/**
 * Un-archives a document via a form submission (owner-gated by
 * {@link restoreArchivedDocumentForUser}) and revalidates the workspace layout
 * so the restored document reappears in the file tree and leaves the Bin.
 */
export async function restoreArchivedDocumentAction(formData: FormData) {
  const user = await requireActiveUser();
  const documentId = documentIdSchema.parse(formData.get("documentId"));

  await restoreArchivedDocumentForUser(user.id, documentId);

  revalidatePath("/", "layout");
}

/**
 * Permanently deletes the user's archived documents whose `deletedAt` is older
 * than `retentionDays`. A no-op when `retentionDays` is null ("Never"). A single
 * hard delete is safe: every `document_*` child table references `documents.id`
 * with `onDelete: "cascade"`. Called lazily on workspace load (see
 * {@link getWorkspaceData}).
 */

/**
 * Lists the user's archived (soft-deleted) documents for the Bin, most recently
 * archived first. `deletedAt` is guaranteed non-null by the filter.
 */

export async function shareDocumentAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = shareDocumentSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    query: formData.get("query"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(user.id, input.documentId);

  if (!allowed) {
    notFound();
  }

  const query = input.query?.trim() ?? "";
  const normalizedQuery = query.toLowerCase().replace(/^@/, "");
  const [targetUser] = input.userId
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    : await db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            eq(users.email, query.toLowerCase()),
            eq(users.username, normalizedQuery),
          ),
        )
        .limit(1);

  if (!targetUser || targetUser.id === user.id) {
    redirect(`/docs/${input.documentId}`);
  }

  await db
    .insert(documentPermissions)
    .values({
      documentId: input.documentId,
      userId: targetUser.id,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [documentPermissions.documentId, documentPermissions.userId],
      set: {
        role: input.role,
        updatedAt: sql`now()`,
      },
    });

  redirect(`/docs/${input.documentId}`);
}

export async function shareDocumentWithFriendAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = shareFriendDocumentSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(user.id, input.documentId);

  if (!allowed || input.userId === user.id) {
    notFound();
  }

  const pair = normalizeFriendPair(user.id, input.userId);
  const [friendship] = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.userLowId, pair.userLowId),
        eq(friendships.userHighId, pair.userHighId),
      ),
    )
    .limit(1);

  if (!friendship) {
    notFound();
  }

  await db
    .insert(documentPermissions)
    .values({
      documentId: input.documentId,
      userId: input.userId,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [documentPermissions.documentId, documentPermissions.userId],
      set: {
        role: input.role,
        updatedAt: sql`now()`,
      },
    });

  redirect(`/docs/${input.documentId}`);
}

export async function updateCollaboratorRoleAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = updateCollaboratorRoleSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(user.id, input.documentId);

  if (!allowed || input.userId === user.id) {
    notFound();
  }

  await db
    .update(documentPermissions)
    .set({
      role: input.role,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(documentPermissions.documentId, input.documentId),
        eq(documentPermissions.userId, input.userId),
        ne(documentPermissions.role, "owner"),
      ),
    );

  redirect(`/docs/${input.documentId}`);
}

export async function removeCollaboratorAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = collaboratorMutationSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
  });

  const allowed = await canShareDocument(user.id, input.documentId);

  if (!allowed || input.userId === user.id) {
    notFound();
  }

  await db
    .delete(documentPermissions)
    .where(
      and(
        eq(documentPermissions.documentId, input.documentId),
        eq(documentPermissions.userId, input.userId),
        ne(documentPermissions.role, "owner"),
      ),
    );

  redirect(`/docs/${input.documentId}`);
}

export async function updateDocumentShareLinkAction(formData: FormData) {
  const user = await requireActiveUser();
  const input = updateShareLinkSchema.parse({
    documentId: formData.get("documentId"),
    mode: formData.get("mode"),
  });

  const allowed = await canShareDocument(user.id, input.documentId);

  if (!allowed) {
    notFound();
  }

  const [existingLink] = await db
    .select({ id: documentShareLinks.id })
    .from(documentShareLinks)
    .where(eq(documentShareLinks.documentId, input.documentId))
    .orderBy(desc(documentShareLinks.createdAt))
    .limit(1);

  if (input.mode === "off") {
    if (existingLink) {
      await db
        .update(documentShareLinks)
        .set({
          enabled: 0,
          updatedAt: sql`now()`,
        })
        .where(eq(documentShareLinks.documentId, input.documentId));
    }
  } else {
    const mode = shareLinkModeToValues(input.mode);

    if (existingLink) {
      await db
        .update(documentShareLinks)
        .set({
          enabled: 0,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(documentShareLinks.documentId, input.documentId),
            ne(documentShareLinks.id, existingLink.id),
          ),
        );

      await db
        .update(documentShareLinks)
        .set({
          scope: mode.scope,
          role: mode.role,
          enabled: 1,
          expiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(documentShareLinks.id, existingLink.id));
    } else {
      await db.insert(documentShareLinks).values({
        documentId: input.documentId,
        tokenHash: crypto.randomUUID(),
        scope: mode.scope,
        role: mode.role,
        enabled: 1,
        createdBy: user.id,
      });
    }
  }

  revalidatePath(`/docs/${input.documentId}`);
}

export async function publishDocumentAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = publishMutationSchema.parse({
    documentId: formData.get("documentId"),
  });

  const allowed = (await getDocumentAccess(user.id, input.documentId))
    .canPublish;

  if (!allowed) {
    notFound();
  }

  const [document] = await db
    .select({
      title: documents.title,
      publicSlug: documents.publicSlug,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    notFound();
  }

  const publicSlug =
    document.publicSlug ?? (await createUniquePublicSlug(document.title));

  await db
    .update(documents)
    .set({
      visibility: "public",
      publicSlug,
      updatedAt: sql`now()`,
    })
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));

  redirect(`/docs/${input.documentId}`);
}

export async function unpublishDocumentAction(formData: FormData) {
  const user = await requireActiveUser();

  const input = publishMutationSchema.parse({
    documentId: formData.get("documentId"),
  });

  const allowed = (await getDocumentAccess(user.id, input.documentId))
    .canPublish;

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      visibility: "private",
      updatedAt: sql`now()`,
    })
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));

  redirect(`/docs/${input.documentId}`);
}

/**
 * Documents that live inside a folder the user owns but were created by someone
 * else (e.g. a folder collaborator with editor access). The folder owner can
 * access these through folder ownership, so they belong in the owner's folder
 * tree even though they are not in `listDocumentsForUser`.
 */

/**
 * Documents shared with a user — both direct document shares and documents the
 * user reaches through a shared folder (or any of its descendants). Owner
 * details are attached so the sidebar can group "Shared with me" by owner.
 */

export async function listPublicDocuments(
  options: {
    userId?: string | null;
    query?: ContentSearchQuery;
    limit?: number;
  } = {},
) {
  const where = buildPublicDocumentSearchWhere(options.query);
  const textTerms = options.query?.textTerms ?? [];
  const sort = options.query?.filters.sort;
  const useRelevanceSort = textTerms.length > 0 && sort !== "score" && sort !== "trending";

  const baseQuery = db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      publicSlug: documents.publicSlug,
      updatedAt: documents.updatedAt,
      ownerName: users.name,
      ownerUsername: users.username,
    })
    .from(documents)
    .innerJoin(users, eq(documents.ownerId, users.id))
    .where(
      and(
        eq(documents.visibility, "public"),
        isNotNull(documents.publicSlug),
        isNull(documents.deletedAt),
        where,
      ),
    );

  const rows = await (useRelevanceSort
    ? baseQuery.orderBy(desc(buildDocumentRelevanceScore(textTerms)), desc(documents.updatedAt))
    : baseQuery.orderBy(desc(documents.updatedAt)));

  const limitedRows = options.limit ? rows.slice(0, options.limit) : rows;

  const documentIds = limitedRows.map((document) => document.id);
  const [tagMap, statsMap] = await Promise.all([
    listTagsForDocumentIds(documentIds),
    getDocumentContentStats(documentIds, options.userId),
  ]);

  return limitedRows.map((document) => ({
    ...document,
    tags: tagMap.get(document.id) ?? [],
    stats: statsMap.get(document.id) ?? {
      likeCount: 0,
      viewCount: 0,
      viewerHasLiked: false,
      score: 0,
      trendingScore: 0,
    },
  }));
}

function buildDocumentRelevanceScore(textTerms: string[]): SQL<number> {
  const termScores = textTerms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    const tagSlug = normalizeTagSlug(term);
    const tagBoost = tagSlug
      ? sql<number>`case when ${publicDocumentHasTag(tagSlug)} then 3 else 0 end`
      : sql<number>`0`;

    return sql<number>`(case
      when lower(${documents.title}) = ${term} then 8
      when lower(${documents.title}) like ${pattern} escape '\\' then 4
      else 0
    end + ${tagBoost}
    + case when exists (
        select 1 from ${documentMetadata}
        where ${documentMetadata.documentId} = ${documents.id}
        and lower(coalesce(${documentMetadata.summary}, '')) like ${pattern} escape '\\'
      ) then 2 else 0 end
    + case when
        lower(coalesce(${users.name}, '')) like ${pattern} escape '\\'
        or lower(coalesce(${users.username}, '')) like ${pattern} escape '\\'
      then 1 else 0 end)`;
  });

  return termScores.length === 1
    ? termScores[0]!
    : sql<number>`(${sql.join(termScores, sql` + `)})`;
}

function buildPublicDocumentSearchWhere(query?: ContentSearchQuery) {
  if (!query || contentSearchIsEmpty(query)) {
    return undefined;
  }

  const conditions: SQL[] = [];

  if (
    query.filters.kind &&
    !["document", "doc", "note", "public"].includes(query.filters.kind)
  ) {
    conditions.push(sql`false`);
  }

  if (query.filters.visibility && query.filters.visibility !== "public") {
    conditions.push(sql`false`);
  }

  if (query.filters.owner) {
    const ownerPattern = `%${escapeLike(query.filters.owner)}%`;
    conditions.push(sql`(
      lower(coalesce(${users.name}, '')) like ${ownerPattern} escape '\\'
      or lower(coalesce(${users.username}, '')) like ${ownerPattern} escape '\\'
    )`);
  }

  for (const tag of query.tagTerms) {
    conditions.push(publicDocumentHasTag(tag));
  }

  for (const term of query.textTerms) {
    const pattern = `%${escapeLike(term)}%`;
    const tagSlug = normalizeTagSlug(term);
    conditions.push(sql`(
      lower(${documents.title}) like ${pattern} escape '\\'
      or lower(${documents.markdown}) like ${pattern} escape '\\'
      or lower(coalesce(${documents.publicSlug}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${users.name}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${users.username}, '')) like ${pattern} escape '\\'
      or exists (
        select 1 from ${documentMetadata}
        where ${documentMetadata.documentId} = ${documents.id}
        and (
          lower(coalesce(${documentMetadata.summary}, '')) like ${pattern} escape '\\'
          or lower(coalesce(${documentMetadata.status}, '')) like ${pattern} escape '\\'
          or lower(coalesce(${documentMetadata.project}, '')) like ${pattern} escape '\\'
          or lower(${documentMetadata.aliases}::text) like ${pattern} escape '\\'
        )
      )
      or ${tagSlug ? publicDocumentHasTag(tagSlug) : sql`false`}
    )`);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function publicDocumentHasTag(tag: string) {
  return sql`exists (
    select 1
    from ${documentTags}
    inner join ${tags} on ${tags.id} = ${documentTags.tagId}
    where ${documentTags.documentId} = ${documents.id}
    and ${tags.slug} = ${tag}
  )`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listTagsForDocumentIds(documentIds: string[]) {
  const tagMap = new Map<string, string[]>();
  const uniqueDocumentIds = [...new Set(documentIds)];

  if (uniqueDocumentIds.length === 0) {
    return tagMap;
  }

  const rows = await db
    .select({
      documentId: documentTags.documentId,
      slug: tags.slug,
    })
    .from(documentTags)
    .innerJoin(tags, eq(documentTags.tagId, tags.id))
    .where(inArray(documentTags.documentId, uniqueDocumentIds));

  for (const row of rows) {
    tagMap.set(row.documentId, [
      ...(tagMap.get(row.documentId) ?? []),
      row.slug,
    ]);
  }

  return tagMap;
}

export async function listPublicWikiLinkResolutions(
  options: {
    includeEmbeds?: boolean;
    includeDocKeys?: boolean;
    includeTitleKeys?: boolean;
    includePublicKeys?: boolean;
    workspaceHrefs?: boolean;
  } = {},
) {
  const definitionDocumentIds = await listDefinitionDocumentIds();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
      ownerUsername: users.username,
    })
    .from(documents)
    .innerJoin(users, eq(documents.ownerId, users.id))
    .where(
      and(
        eq(documents.visibility, "public"),
        isNotNull(documents.publicSlug),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(documents.title);

  return buildWikiLinkResolutionMap(
    rows,
    (document) =>
      document.publicSlug
        ? `${options.workspaceHrefs ? "/workspace/public" : "/public"}/${document.publicSlug}`
        : null,
    {
      includeEmbeds: options.includeEmbeds ?? true,
      includeDocKeys: options.includeDocKeys ?? true,
      includeTitleKeys: options.includeTitleKeys ?? true,
      includePublicKeys: options.includePublicKeys ?? true,
      definitionDocumentIds,
      sourceForDocument: () => "public",
    },
  );
}

/**
 * Lists people who can reach a document through a shared folder (the document's
 * folder or any ancestor), with the folder that grants the access. Used to show
 * inherited collaborators in the document share dialog. Owner-gated like the
 * direct collaborator list.
 */

export async function getPublicDocumentBySlug(
  slug: string,
  options: { userId?: string | null } = {},
) {
  const [document] = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      updatedAt: documents.updatedAt,
      ownerName: users.name,
      ownerUsername: users.username,
      ownerImage: users.image,
    })
    .from(documents)
    .innerJoin(users, eq(documents.ownerId, users.id))
    .where(
      and(
        eq(documents.publicSlug, slug),
        eq(documents.visibility, "public"),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!document) {
    return null;
  }

  const statsMap = await getDocumentContentStats([document.id], options.userId);

  return {
    ...document,
    stats: statsMap.get(document.id) ?? {
      likeCount: 0,
      viewCount: 0,
      viewerHasLiked: false,
      score: 0,
      trendingScore: 0,
    },
  };
}

async function createUniquePublicSlug(title: string) {
  const baseSlug = slugify(title);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate =
      attempt === 0
        ? baseSlug
        : `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.publicSlug, candidate))
      .limit(1);

    if (!existing) {
      return candidate;
    }
  }

  return `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Ids of every document carrying the reserved `definition` tag.
 *
 * Deliberately unscoped: it is only ever used as a membership test against rows
 * a caller has already resolved as readable, so it leaks nothing, and one narrow
 * indexed join beats passing thousands of readable ids into an `in (...)` list.
 */

function shareLinkModeToValues(
  mode: z.infer<typeof updateShareLinkSchema>["mode"],
) {
  switch (mode) {
    case "anyone-viewer":
      return { scope: "anyone" as const, role: "viewer" as const };
    case "members-editor":
      return { scope: "members" as const, role: "editor" as const };
    case "members-viewer":
    default:
      return { scope: "members" as const, role: "viewer" as const };
  }
}

async function maybeCreateAutomaticDocumentVersion(
  tx: DocumentVersionExecutor,
  {
    document,
    actorId,
    reason,
    nextTitle,
    nextMarkdown,
  }: {
    document: VersionableDocument;
    actorId: string | null;
    reason: string;
    nextTitle: string;
    nextMarkdown: string;
  },
) {
  if (document.title === nextTitle && document.markdown === nextMarkdown) {
    return;
  }

  const [latestVersion] = await tx
    .select({
      createdAt: documentVersions.createdAt,
      title: documentVersions.title,
      markdown: documentVersions.markdown,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, document.id))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  if (
    latestVersion &&
    latestVersion.title === document.title &&
    latestVersion.markdown === document.markdown
  ) {
    return;
  }

  const latestAgeMs = latestVersion
    ? Date.now() - latestVersion.createdAt.getTime()
    : Number.POSITIVE_INFINITY;
  const diffSize = Math.abs(document.markdown.length - nextMarkdown.length);
  const relativeDiff =
    diffSize / Math.max(document.markdown.length, nextMarkdown.length, 1);
  const shouldSnapshot =
    !latestVersion ||
    latestAgeMs >= automaticVersionIntervalMs ||
    diffSize >= significantVersionAbsoluteDiff ||
    relativeDiff >= significantVersionRelativeDiff;

  if (!shouldSnapshot) {
    return;
  }

  await createDocumentVersion(tx, {
    document,
    actorId,
    reason,
  });
}

