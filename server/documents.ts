"use server";

import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { documentPermissions, documents, friendships, users } from "@/db/schema";
import {
  emptyDocumentContent,
  isProseMirrorDoc,
} from "@/lib/editor-content";
import {
  canDeleteDocument,
  canEditDocument,
  canShareDocument,
  getDocumentAccess,
} from "@/lib/permissions";
import { maxMarkdownLength } from "@/lib/markdown";
import { slugify } from "@/lib/slug";

const documentIdSchema = z.string().uuid();
const initialMarkdownContent = "# Untitled document\n\nStart writing...\n";

const updateDocumentSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
  contentJson: z.string().max(1_000_000),
});

const saveDocumentDraftSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().min(1, "Title is required").max(200),
  content: z.unknown(),
});

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

const updateCollaboratorRoleSchema = collaboratorMutationSchema.extend({
  role: z.enum(["viewer", "editor"]),
});

function parseDocumentContent(contentJson: string) {
  const parsed = JSON.parse(contentJson) as unknown;

  if (!isProseMirrorDoc(parsed)) {
    throw new Error("Invalid document content");
  }

  return parsed;
}

function validateDocumentContent(content: unknown) {
  const contentJson = JSON.stringify(content);

  if (contentJson.length > 1_000_000 || !isProseMirrorDoc(content)) {
    throw new Error("Invalid document content");
  }

  return content;
}

function normalizeFriendPair(userA: string, userB: string) {
  return userA < userB
    ? { userLowId: userA, userHighId: userB }
    : { userLowId: userB, userHighId: userA };
}

export async function createDocumentAction() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [document] = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        ownerId: session.user.id,
        title: "Untitled document",
        markdown: initialMarkdownContent,
        content: emptyDocumentContent,
      })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId: session.user.id,
      role: "owner",
    });

    return [createdDocument];
  });

  redirect(`/docs/${document.id}`);
}

export async function updateDocumentAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = updateDocumentSchema.parse({
    documentId: formData.get("documentId"),
    title: formData.get("title"),
    contentJson: formData.get("contentJson"),
  });

  const allowed = await canEditDocument(session.user.id, input.documentId);

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      title: input.title,
      content: parseDocumentContent(input.contentJson),
      updatedAt: sql`now()`,
    })
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));

  redirect(`/docs/${input.documentId}`);
}

export async function saveDocumentDraftAction(
  input: unknown,
): Promise<
  | { ok: true; updatedAt: string }
  | { ok: false; message: string }
> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const parsed = saveDocumentDraftSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the title and try saving again.",
    };
  }

  let content;

  try {
    content = validateDocumentContent(parsed.data.content);
  } catch {
    return {
      ok: false,
      message: "This document is too large or has invalid content.",
    };
  }

  const allowed = await canEditDocument(session.user.id, parsed.data.documentId);

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      title: parsed.data.title,
      content,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
    );

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveMarkdownDocumentAction(
  input: unknown,
): Promise<
  | { ok: true; updatedAt: string }
  | { ok: false; message: string }
> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const parsed = saveMarkdownDocumentSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "This Markdown document is too large or has an invalid title.",
    };
  }

  const allowed = await canEditDocument(session.user.id, parsed.data.documentId);

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      title: parsed.data.title,
      markdown: parsed.data.markdown,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
    );

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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const parsed = saveDocumentTitleSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the title and try saving again.",
    };
  }

  const allowed = await canEditDocument(session.user.id, parsed.data.documentId);

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      title: parsed.data.title,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(documents.id, parsed.data.documentId), isNull(documents.deletedAt)),
    );

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function archiveDocumentAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const documentId = documentIdSchema.parse(formData.get("documentId"));
  const allowed = await canDeleteDocument(session.user.id, documentId);

  if (!allowed) {
    notFound();
  }

  await db
    .update(documents)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));

  redirect("/dashboard");
}

export async function shareDocumentAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = shareDocumentSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    query: formData.get("query"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(session.user.id, input.documentId);

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

  if (!targetUser || targetUser.id === session.user.id) {
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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = shareFriendDocumentSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(session.user.id, input.documentId);

  if (!allowed || input.userId === session.user.id) {
    notFound();
  }

  const pair = normalizeFriendPair(session.user.id, input.userId);
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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = updateCollaboratorRoleSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  const allowed = await canShareDocument(session.user.id, input.documentId);

  if (!allowed || input.userId === session.user.id) {
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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = collaboratorMutationSchema.parse({
    documentId: formData.get("documentId"),
    userId: formData.get("userId"),
  });

  const allowed = await canShareDocument(session.user.id, input.documentId);

  if (!allowed || input.userId === session.user.id) {
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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = publishMutationSchema.parse({
    documentId: formData.get("documentId"),
  });

  const allowed = (await getDocumentAccess(session.user.id, input.documentId))
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
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = publishMutationSchema.parse({
    documentId: formData.get("documentId"),
  });

  const allowed = (await getDocumentAccess(session.user.id, input.documentId))
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
      content: documents.content,
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
      content: documents.content,
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
      content: documents.content,
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
      content: documents.content,
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
      content: documents.content,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
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
