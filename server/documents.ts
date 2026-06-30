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
  folderPermissions,
  folders,
  friendships,
  tags,
  users,
  type DocumentRole,
  type DocumentVisibility,
} from "@/db/schema";
import {
  canDeleteDocument,
  canEditDocument,
  canEditFolderContents,
  canShareDocument,
  type DocumentAccess,
  getDocumentAccess,
} from "@/lib/permissions";
import { maxMarkdownLength } from "@/lib/markdown";
import {
  type ContentSearchQuery,
  contentSearchIsEmpty,
} from "@/lib/content-search-query";
import { coerceDates } from "@/lib/db-rows";
import { normalizeTagSlug } from "@/lib/content-metadata";
import { slugify } from "@/lib/slug";
import {
  extractMarkdownAnchorOptions,
  extractMarkdownHeadingOptions,
  type WikiLinkResolution,
  type WikiLinkResolutionMap,
  wikiDocKey,
  wikiPublicKey,
  wikiTitleKey,
} from "@/lib/wiki-links";
import { requireActiveUser } from "@/server/authz";
import { reconcileDocumentAssetLinks } from "@/server/assets";
import { syncDocumentMetadata } from "@/server/content-metadata";
import { getDocumentContentStats } from "@/server/content-interactions";

const documentIdSchema = z.string().uuid();
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
const shareLinkIdSchema = z.string().uuid();

type VersionableDocument = {
  id: string;
  title: string;
  markdown: string;
};
type DocumentVersionExecutor = Pick<typeof db, "select" | "insert">;

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
export async function createDocumentForUser(
  userId: string,
  input: { title?: string; markdown?: string } = {},
): Promise<{ id: string }> {
  const title = (input.title?.trim() || "Untitled document").slice(0, 200);
  const markdown = input.markdown ?? initialMarkdownContent;

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

  await db.transaction(async (tx) => {
    const [currentDocument] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(
        and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
      )
      .limit(1);

    if (!currentDocument) {
      notFound();
    }

    await maybeCreateAutomaticDocumentVersion(tx, {
      document: currentDocument,
      actorId: user.id,
      reason: "auto",
      nextTitle: parsed.data.title,
      nextMarkdown: parsed.data.markdown,
    });

    await tx
      .update(documents)
      .set({
        title: parsed.data.title,
        markdown: parsed.data.markdown,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
      );

    await tx
      .delete(documentCollabStates)
      .where(eq(documentCollabStates.documentId, parsed.data.documentId));
  });
  await reconcileDocumentAssetLinks({
    documentId: parsed.data.documentId,
    markdown: parsed.data.markdown,
  });
  await syncDocumentMetadata({
    documentId: parsed.data.documentId,
    markdown: parsed.data.markdown,
  });

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
  };
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

  await db.transaction(async (tx) => {
    const [currentDocument] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        markdown: documents.markdown,
      })
      .from(documents)
      .where(
        and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
      )
      .limit(1);

    if (!currentDocument) {
      notFound();
    }

    await maybeCreateAutomaticDocumentVersion(tx, {
      document: currentDocument,
      actorId: user.id,
      reason: "auto",
      nextTitle: parsed.data.title,
      nextMarkdown: currentDocument.markdown,
    });

    await tx
      .update(documents)
      .set({
        title: parsed.data.title,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
      );
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

export async function archiveDocumentAction(formData: FormData) {
  const user = await requireActiveUser();

  const documentId = documentIdSchema.parse(formData.get("documentId"));
  const allowed = await canDeleteDocument(user.id, documentId);

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
      reason: "before_archive",
    });

    await tx
      .update(documents)
      .set({
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  });

  redirect("/dashboard");
}

/**
 * Archives (soft-deletes) a document on behalf of `userId`, snapshotting a
 * version first. Returns false when the document is missing or the user lacks
 * delete permission. Like {@link createDocumentForUser}, this is the redirect-free
 * variant of {@link archiveDocumentAction} for non-UI callers (e.g. MCP). The
 * delete is recoverable from the document's version history / trash.
 */
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

/**
 * Documents that live inside a folder the user owns but were created by someone
 * else (e.g. a folder collaborator with editor access). The folder owner can
 * access these through folder ownership, so they belong in the owner's folder
 * tree even though they are not in `listDocumentsForUser`.
 */
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

/**
 * Documents shared with a user — both direct document shares and documents the
 * user reaches through a shared folder (or any of its descendants). Owner
 * details are attached so the sidebar can group "Shared with me" by owner.
 */
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

async function listTagsForDocumentIds(documentIds: string[]) {
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

export async function listWikiLinkResolutionsForUser(
  userId: string,
  options: { includeEmbeds?: boolean } = {},
) {
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
      sourceForDocument: (document) =>
        document.ownerId === userId || document.sharedUserId === userId
          ? "document"
          : document.visibility === "public"
            ? "public"
            : "document",
    },
  );
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
      sourceForDocument: () => "public",
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

/**
 * Lists people who can reach a document through a shared folder (the document's
 * folder or any ancestor), with the folder that grants the access. Used to show
 * inherited collaborators in the document share dialog. Owner-gated like the
 * direct collaborator list.
 */
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

function buildWikiLinkResolutionMap<
  TDocument extends {
    id: string;
    title: string;
    markdown?: string;
    visibility: string;
    publicSlug: string | null;
    ownerUsername?: string | null;
  },
>(
  documentsToLink: TDocument[],
  hrefForDocument: (document: TDocument) => string | null,
  options:
    | boolean
    | {
        includeEmbeds?: boolean;
        includeDocKeys?: boolean;
        includeTitleKeys?: boolean;
        includePublicKeys?: boolean;
        sourceForDocument?: (
          document: TDocument,
        ) => WikiLinkResolution["source"];
      } = true,
) {
  const normalizedOptions =
    typeof options === "boolean" ? { includeEmbeds: options } : options;
  const includeEmbeds = normalizedOptions.includeEmbeds ?? true;
  const includeDocKeys = normalizedOptions.includeDocKeys ?? true;
  const includeTitleKeys = normalizedOptions.includeTitleKeys ?? true;
  const includePublicKeys = normalizedOptions.includePublicKeys ?? true;
  const resolutions: WikiLinkResolutionMap = {};
  const byTitle = new Map<string, TDocument[]>();

  for (const document of documentsToLink) {
    const href = hrefForDocument(document);
    const source = normalizedOptions.sourceForDocument?.(document) ?? "document";
    const resolution: WikiLinkResolution = href
      ? {
        status: "resolved",
        source,
        documentId: document.id,
        label: document.title,
        href,
        embedMarkdown: includeEmbeds ? document.markdown : undefined,
        ownerUsername: document.ownerUsername,
        headings: extractMarkdownHeadingOptions(document.markdown ?? ""),
        anchors: extractMarkdownAnchorOptions(document.markdown ?? ""),
      }
      : {
          status: "private",
          source,
          label: document.title,
          ownerUsername: document.ownerUsername,
        };

    if (includeDocKeys) {
      resolutions[wikiDocKey(document.id)] = resolution;
    }

    if (includePublicKeys && document.publicSlug) {
      resolutions[wikiPublicKey(document.publicSlug)] = {
        ...resolution,
        source: "public",
      };
    }

    const titleKey = wikiTitleKey(document.title);
    byTitle.set(titleKey, [...(byTitle.get(titleKey) ?? []), document]);
  }

  if (!includeTitleKeys) {
    return resolutions;
  }

  for (const [titleKey, matches] of byTitle) {
    if (matches.length !== 1) {
      resolutions[titleKey] = {
        status: "ambiguous",
        label: matches[0]?.title,
      };
      continue;
    }

    const match = matches[0];
    const href = hrefForDocument(match);
    const source = normalizedOptions.sourceForDocument?.(match) ?? "document";
    resolutions[titleKey] = href
      ? {
          status: "resolved",
          source,
          documentId: match.id,
          label: match.title,
          href,
          embedMarkdown: includeEmbeds ? match.markdown : undefined,
          ownerUsername: match.ownerUsername,
          headings: extractMarkdownHeadingOptions(match.markdown ?? ""),
          anchors: extractMarkdownAnchorOptions(match.markdown ?? ""),
        }
      : {
          status: "private",
          source,
          label: match.title,
          ownerUsername: match.ownerUsername,
        };
  }

  return resolutions;
}

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

async function createDocumentVersion(
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
