import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { documents, documentSnippets, snippets } from "@/db/schema";
import { SNIPPET_LIMITS, type SnippetStatus } from "@/lib/config/snippet-limits";
import { compileSnippet, type SnippetDiagnostic } from "@/lib/snippets/compile";
import { getUserSetting } from "@/server/user-settings";

export type SnippetSummary = {
  id: string;
  name: string;
  description: string | null;
  status: SnippetStatus;
  sourceBytes: number;
  compiledBytes: number;
  attachedCount: number;
  updatedAt: Date;
};

export type SnippetDetail = SnippetSummary & {
  sourceCss: string;
};

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(60)
  .regex(
    /^[a-z0-9][a-z0-9 _-]*$/i,
    "Use letters, numbers, spaces, hyphens, underscores",
  );
const descriptionSchema = z.string().trim().max(280).optional();
const idSchema = z.string().uuid();

function hashCss(css: string): string {
  return createHash("sha256").update(css).digest("hex");
}

export function compileForStorage(sourceCss: string) {
  const result = compileSnippet(sourceCss);
  const status: SnippetStatus = result.ok ? "ok" : "invalid";
  return {
    status,
    compiledCss: result.ok ? result.css : "",
    compiledHash: result.ok ? hashCss(result.css) : "",
    diagnostics: result.diagnostics,
    ok: result.ok,
  };
}

export async function listSnippetsForUser(
  userId: string,
): Promise<SnippetSummary[]> {
  const rows = await db
    .select({
      id: snippets.id,
      name: snippets.name,
      description: snippets.description,
      status: snippets.status,
      sourceCss: snippets.sourceCss,
      compiledCss: snippets.compiledCss,
      updatedAt: snippets.updatedAt,
      attachedCount: sql<number>`(
        select count(*)::int from ${documentSnippets}
        where ${documentSnippets.snippetId} = ${snippets.id}
      )`,
    })
    .from(snippets)
    .where(eq(snippets.ownerId, userId))
    .orderBy(asc(snippets.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    sourceBytes: Buffer.byteLength(row.sourceCss, "utf8"),
    compiledBytes: Buffer.byteLength(row.compiledCss, "utf8"),
    attachedCount: Number(row.attachedCount ?? 0),
    updatedAt: row.updatedAt,
  }));
}

export async function getSnippetForUser(
  userId: string,
  snippetId: string,
): Promise<SnippetDetail | null> {
  const parsed = idSchema.safeParse(snippetId);
  if (!parsed.success) {
    return null;
  }

  const [row] = await db
    .select()
    .from(snippets)
    .where(and(eq(snippets.id, parsed.data), eq(snippets.ownerId, userId)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    sourceCss: row.sourceCss,
    sourceBytes: Buffer.byteLength(row.sourceCss, "utf8"),
    compiledBytes: Buffer.byteLength(row.compiledCss, "utf8"),
    attachedCount: 0,
    updatedAt: row.updatedAt,
  };
}

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; message: string; diagnostics?: SnippetDiagnostic[] };

export async function createSnippetForUser(
  userId: string,
  input: { name: string; description?: string },
): Promise<ActionResult<{ id: string }>> {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) {
    return { ok: false, message: name.error.issues[0]?.message ?? "Invalid name" };
  }
  const description = descriptionSchema.safeParse(input.description ?? undefined);
  if (!description.success) {
    return { ok: false, message: "Invalid description" };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(snippets)
    .where(eq(snippets.ownerId, userId));

  if (Number(count) >= SNIPPET_LIMITS.maxSnippetsPerUser) {
    return {
      ok: false,
      message: `You have reached the maximum of ${SNIPPET_LIMITS.maxSnippetsPerUser} snippets`,
    };
  }

  try {
    const [row] = await db
      .insert(snippets)
      .values({
        ownerId: userId,
        name: name.data,
        description: description.data ?? null,
      })
      .returning({ id: snippets.id });

    return { ok: true, data: { id: row.id } };
  } catch {
    return { ok: false, message: "A snippet with that name already exists" };
  }
}

export async function updateSnippetForUser(
  userId: string,
  snippetId: string,
  input: { name?: string; description?: string | null; sourceCss?: string },
): Promise<ActionResult<{ status: SnippetStatus; diagnostics: SnippetDiagnostic[] }>> {
  const parsed = idSchema.safeParse(snippetId);
  if (!parsed.success) {
    return { ok: false, message: "Invalid snippet" };
  }

  const [existing] = await db
    .select({ id: snippets.id })
    .from(snippets)
    .where(and(eq(snippets.id, parsed.data), eq(snippets.ownerId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, message: "Snippet not found" };
  }

  const patch: Partial<typeof snippets.$inferInsert> = {
    updatedAt: new Date(),
  };
  let diagnostics: SnippetDiagnostic[] = [];
  let status: SnippetStatus = "ok";

  if (input.name !== undefined) {
    const name = nameSchema.safeParse(input.name);
    if (!name.success) {
      return { ok: false, message: name.error.issues[0]?.message ?? "Invalid name" };
    }
    patch.name = name.data;
  }

  if (input.description !== undefined) {
    const description = descriptionSchema.safeParse(
      input.description ?? undefined,
    );
    if (!description.success) {
      return { ok: false, message: "Invalid description" };
    }
    patch.description = description.data ?? null;
  }

  if (input.sourceCss !== undefined) {
    if (Buffer.byteLength(input.sourceCss, "utf8") > SNIPPET_LIMITS.maxSourceBytes) {
      return { ok: false, message: "Snippet is too large" };
    }
    const compiled = compileForStorage(input.sourceCss);
    diagnostics = compiled.diagnostics;
    status = compiled.status;
    patch.sourceCss = input.sourceCss;
    patch.compiledCss = compiled.compiledCss;
    patch.compiledHash = compiled.compiledHash;
    patch.status = compiled.status;
  }

  try {
    await db
      .update(snippets)
      .set(patch)
      .where(and(eq(snippets.id, parsed.data), eq(snippets.ownerId, userId)));
  } catch {
    return { ok: false, message: "A snippet with that name already exists" };
  }

  return { ok: true, data: { status, diagnostics } };
}

export async function deleteSnippetForUser(
  userId: string,
  snippetId: string,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(snippetId);
  if (!parsed.success) {
    return { ok: false, message: "Invalid snippet" };
  }

  await db
    .delete(snippets)
    .where(and(eq(snippets.id, parsed.data), eq(snippets.ownerId, userId)));

  return { ok: true };
}

async function assertDocumentOwner(userId: string, documentId: string) {
  const parsed = idSchema.safeParse(documentId);
  if (!parsed.success) {
    return null;
  }
  const [doc] = await db
    .select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.id, parsed.data))
    .limit(1);
  return doc && doc.ownerId === userId ? parsed.data : null;
}

export type DocumentSnippetAttachment = {
  snippetId: string;
  name: string;
  status: SnippetStatus;
  sortOrder: number;
};

export async function listDocumentSnippetAttachmentsForOwner(
  userId: string,
  documentId: string,
): Promise<{ attached: DocumentSnippetAttachment[]; available: SnippetSummary[] } | null> {
  const docId = await assertDocumentOwner(userId, documentId);
  if (!docId) {
    return null;
  }

  const attachedRows = await db
    .select({
      snippetId: documentSnippets.snippetId,
      sortOrder: documentSnippets.sortOrder,
      name: snippets.name,
      status: snippets.status,
    })
    .from(documentSnippets)
    .innerJoin(snippets, eq(snippets.id, documentSnippets.snippetId))
    .where(eq(documentSnippets.documentId, docId))
    .orderBy(asc(documentSnippets.sortOrder));

  const all = await listSnippetsForUser(userId);
  const attachedIds = new Set(attachedRows.map((row) => row.snippetId));

  return {
    attached: attachedRows.map((row) => ({
      snippetId: row.snippetId,
      name: row.name,
      status: row.status,
      sortOrder: row.sortOrder,
    })),
    available: all.filter((snippet) => !attachedIds.has(snippet.id)),
  };
}

export async function attachSnippetToDocument(
  userId: string,
  documentId: string,
  snippetId: string,
): Promise<ActionResult> {
  const docId = await assertDocumentOwner(userId, documentId);
  if (!docId) {
    return { ok: false, message: "Document not found" };
  }
  const snippet = idSchema.safeParse(snippetId);
  if (!snippet.success) {
    return { ok: false, message: "Invalid snippet" };
  }

  const [owned] = await db
    .select({ id: snippets.id })
    .from(snippets)
    .where(and(eq(snippets.id, snippet.data), eq(snippets.ownerId, userId)))
    .limit(1);
  if (!owned) {
    return { ok: false, message: "Snippet not found" };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentSnippets)
    .where(eq(documentSnippets.documentId, docId));

  if (Number(count) >= SNIPPET_LIMITS.maxSnippetsPerDocument) {
    return {
      ok: false,
      message: `A document can have at most ${SNIPPET_LIMITS.maxSnippetsPerDocument} snippets`,
    };
  }

  await db
    .insert(documentSnippets)
    .values({ documentId: docId, snippetId: snippet.data, sortOrder: Number(count) })
    .onConflictDoNothing();

  return { ok: true };
}

export async function detachSnippetFromDocument(
  userId: string,
  documentId: string,
  snippetId: string,
): Promise<ActionResult> {
  const docId = await assertDocumentOwner(userId, documentId);
  if (!docId) {
    return { ok: false, message: "Document not found" };
  }
  const snippet = idSchema.safeParse(snippetId);
  if (!snippet.success) {
    return { ok: false, message: "Invalid snippet" };
  }

  await db
    .delete(documentSnippets)
    .where(
      and(
        eq(documentSnippets.documentId, docId),
        eq(documentSnippets.snippetId, snippet.data),
      ),
    );

  return { ok: true };
}

export async function reorderDocumentSnippets(
  userId: string,
  documentId: string,
  orderedSnippetIds: string[],
): Promise<ActionResult> {
  const docId = await assertDocumentOwner(userId, documentId);
  if (!docId) {
    return { ok: false, message: "Document not found" };
  }

  const ids = z.array(idSchema).safeParse(orderedSnippetIds);
  if (!ids.success) {
    return { ok: false, message: "Invalid order" };
  }

  await db.transaction(async (tx) => {
    for (let index = 0; index < ids.data.length; index += 1) {
      await tx
        .update(documentSnippets)
        .set({ sortOrder: index })
        .where(
          and(
            eq(documentSnippets.documentId, docId),
            eq(documentSnippets.snippetId, ids.data[index]),
          ),
        );
    }
  });

  return { ok: true };
}

/**
 * Viewer-facing: the concatenated, compiled snippet CSS to apply to a document,
 * in attachment order, `ok` snippets only. Callers must have already resolved
 * the viewer's read permission for the document (this returns styling only, no
 * private data). The result still contains the scope placeholder; DocumentCanvas
 * substitutes the document id.
 */
export async function getActiveSnippetCssForDocument(
  documentId: string,
): Promise<string> {
  const parsed = idSchema.safeParse(documentId);
  if (!parsed.success) {
    return "";
  }

  const rows = await db
    .select({
      compiledCss: snippets.compiledCss,
      status: snippets.status,
    })
    .from(documentSnippets)
    .innerJoin(snippets, eq(snippets.id, documentSnippets.snippetId))
    .where(eq(documentSnippets.documentId, parsed.data))
    .orderBy(asc(documentSnippets.sortOrder));

  return rows
    .filter((row) => row.status === "ok" && row.compiledCss)
    .map((row) => row.compiledCss)
    .join("\n");
}

/**
 * Viewer's global "apply author styling" preference (appearance/snippets).
 * Defaults to true (including for anonymous viewers, who then use the per-view
 * pill toggle). When false, surfaces skip snippet fetch entirely.
 */
export async function getViewerStylingPreference(
  userId: string | null,
): Promise<boolean> {
  if (!userId) {
    return true;
  }
  const row = await getUserSetting({
    userId,
    namespace: "appearance",
    key: "snippets",
  });
  const value = row?.value as { applyAuthorStyling?: unknown } | null;
  return value?.applyAuthorStyling === false ? false : true;
}

/** Whether a document has any active (ok) attached snippets — for pill display. */
export async function documentHasActiveSnippets(
  documentIds: string[],
): Promise<Set<string>> {
  if (documentIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ documentId: documentSnippets.documentId })
    .from(documentSnippets)
    .innerJoin(snippets, eq(snippets.id, documentSnippets.snippetId))
    .where(
      and(
        inArray(documentSnippets.documentId, documentIds),
        eq(snippets.status, "ok"),
      ),
    );
  return new Set(rows.map((row) => row.documentId));
}
