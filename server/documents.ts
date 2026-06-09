"use server";

import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  documentPermissions,
  documentVersions,
  documents,
  friendships,
  users,
} from "@/db/schema";
import {
  canDeleteDocument,
  canEditDocument,
  canShareDocument,
  getDocumentAccess,
} from "@/lib/permissions";
import { maxMarkdownLength } from "@/lib/markdown";
import { slugify } from "@/lib/slug";
import {
  extractMarkdownAnchorOptions,
  extractMarkdownHeadingOptions,
  type WikiLinkResolution,
  type WikiLinkResolutionMap,
  wikiDocKey,
  wikiTitleKey,
} from "@/lib/wiki-links";
import { requireActiveUser } from "@/server/authz";

const documentIdSchema = z.string().uuid();
const initialMarkdownContent = "# Untitled document\n\nStart writing...\n";
const automaticVersionIntervalMs = 10 * 60 * 1000;
const significantVersionAbsoluteDiff = 2_000;
const significantVersionRelativeDiff = 0.25;

const saveMarkdownDocumentSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
  markdown: z.string().max(maxMarkdownLength),
});

const saveDocumentTitleSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
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

  const allowed = await canEditDocument(user.id, parsed.data.documentId);

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

  const allowed = await canEditDocument(user.id, parsed.data.documentId);

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
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.updatedAt));
}

export async function listSharedDocumentsForUser(userId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      updatedAt: documents.updatedAt,
      role: documentPermissions.role,
    })
    .from(documentPermissions)
    .innerJoin(documents, eq(documentPermissions.documentId, documents.id))
    .where(
      and(
        eq(documentPermissions.userId, userId),
        ne(documentPermissions.role, "owner"),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt));
}

export async function listPublicDocuments() {
  return db
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
      ),
    )
    .orderBy(desc(documents.updatedAt));
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
    })
    .from(documents)
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
    options.includeEmbeds ?? true,
  );
}

export async function listPublicWikiLinkResolutions() {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
    })
    .from(documents)
    .where(
      and(
        eq(documents.visibility, "public"),
        isNotNull(documents.publicSlug),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(documents.title);

  return buildWikiLinkResolutionMap(rows, (document) =>
    document.publicSlug ? `/public/${document.publicSlug}` : null,
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

export async function getPublicDocumentBySlug(slug: string) {
  const [document] = await db
    .select({
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

  return document ?? null;
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

function buildWikiLinkResolutionMap<
  TDocument extends {
    id: string;
    title: string;
    markdown?: string;
    visibility: string;
    publicSlug: string | null;
  },
>(
  documentsToLink: TDocument[],
  hrefForDocument: (document: TDocument) => string | null,
  includeEmbeds = true,
) {
  const resolutions: WikiLinkResolutionMap = {};
  const byTitle = new Map<string, TDocument[]>();

  for (const document of documentsToLink) {
    const href = hrefForDocument(document);
    const resolution: WikiLinkResolution = href
      ? {
        status: "resolved",
        documentId: document.id,
        label: document.title,
        href,
        embedMarkdown: includeEmbeds ? document.markdown : undefined,
        headings: extractMarkdownHeadingOptions(document.markdown ?? ""),
        anchors: extractMarkdownAnchorOptions(document.markdown ?? ""),
      }
      : {
          status: "private",
          label: document.title,
        };

    resolutions[wikiDocKey(document.id)] = resolution;

    const titleKey = wikiTitleKey(document.title);
    byTitle.set(titleKey, [...(byTitle.get(titleKey) ?? []), document]);
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
    resolutions[titleKey] = href
      ? {
          status: "resolved",
          documentId: match.id,
          label: match.title,
          href,
          embedMarkdown: includeEmbeds ? match.markdown : undefined,
          headings: extractMarkdownHeadingOptions(match.markdown ?? ""),
          anchors: extractMarkdownAnchorOptions(match.markdown ?? ""),
        }
      : {
          status: "private",
          label: match.title,
        };
  }

  return resolutions;
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
