import "server-only";

import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  documentMetadata,
  documentPermissions,
  documentTags,
  documents,
  folders,
  tags,
} from "@/db/schema";
import { buildFolderPaths } from "@/lib/folder-paths";
import { canEditFolderContents } from "@/lib/permissions";
import { syncDocumentMetadata } from "@/server/content-metadata";

/**
 * Document services for extensions (`docs/23_EXTENSION_SDK_PLAN.md` §8), for
 * callers that have **already authenticated** the user: the extension action
 * dispatcher and the settings page builder. Extensions never reach these
 * directly; they get them, gated by their declared permissions, through the
 * action context. Generic on purpose: the dictionary builds definitions from
 * them, and nothing here knows what a definition is.
 *
 * Deliberately `server-only` and not `"use server"`. Every export of a
 * `"use server"` module is registered as a callable server action, and these
 * take a `userId` argument — exported from such a module, their only
 * protection would be that no client bundle happens to contain their action id.
 */

const titleSchema = z.string().trim().min(1).max(200);
const folderIdSchema = z.string().uuid();

export type ExtensionDocumentSummary = {
  documentId: string;
  title: string;
  aliases: string[];
  summary: string | null;
};

/**
 * Every document carrying `tagSlug` that the user can read — their own, shared
 * with them, or public — with its aliases and summary.
 *
 * Read-access scoping mirrors `listWikiLinkResolutionsForUser`: a document the
 * user cannot open must not appear in a listing either. The tag may come from
 * the document's frontmatter or from a folder's default tags; both land in
 * `document_tags`.
 */
export async function listDocumentsByTagForUser(
  userId: string,
  tagSlug: string,
): Promise<ExtensionDocumentSummary[]> {
  const rows = await db
    .selectDistinct({
      documentId: documents.id,
      title: documents.title,
      aliases: documentMetadata.aliases,
      summary: documentMetadata.summary,
    })
    .from(documents)
    .innerJoin(documentTags, eq(documentTags.documentId, documents.id))
    .innerJoin(tags, eq(documentTags.tagId, tags.id))
    .leftJoin(documentMetadata, eq(documentMetadata.documentId, documents.id))
    .leftJoin(
      documentPermissions,
      and(
        eq(documentPermissions.documentId, documents.id),
        eq(documentPermissions.userId, userId),
      ),
    )
    .where(
      and(
        eq(tags.slug, tagSlug),
        isNull(documents.deletedAt),
        or(
          eq(documents.ownerId, userId),
          eq(documentPermissions.userId, userId),
          eq(documents.visibility, "public"),
        ),
      ),
    )
    .orderBy(documents.title);

  return rows.map((row) => ({
    documentId: row.documentId,
    title: row.title,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    summary: row.summary ?? null,
  }));
}

/**
 * A document the user owns whose title equals `title`, ignoring case, or
 * null. Owned only: this answers "have I already made this", not "does one
 * exist somewhere".
 */
export async function findOwnedDocumentByTitleForUser(
  userId: string,
  title: string,
): Promise<{ documentId: string; title: string } | null> {
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) return null;

  const [existing] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        isNull(documents.deletedAt),
        ilike(documents.title, parsed.data.replace(/[%_\\]/g, "\\$&")),
      ),
    )
    .limit(1);

  return existing ? { documentId: existing.id, title: existing.title } : null;
}

/**
 * Creates a document the user owns, filed in the first of `folderIds` they may
 * add to, else at their vault root. A folder the user can no longer file into
 * falls back rather than failing: a stale setting must not break authoring.
 * Every candidate is permission-checked here, so callers may pass folder ids
 * straight from a client.
 */
export async function createDocumentForUser(
  userId: string,
  input: {
    title: string;
    markdown: string;
    folderIds?: ReadonlyArray<string | null | undefined>;
  },
): Promise<{ documentId: string; title: string }> {
  const title = titleSchema.parse(input.title);
  let folderId: string | null = null;

  for (const candidate of input.folderIds ?? []) {
    const parsed = folderIdSchema.safeParse(candidate);
    if (parsed.success && (await canEditFolderContents(userId, parsed.data))) {
      folderId = parsed.data;
      break;
    }
  }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({ ownerId: userId, folderId, title, markdown: input.markdown })
      .returning({ id: documents.id });
    await tx.insert(documentPermissions).values({
      documentId: row.id,
      userId,
      role: "owner",
    });
    return [row];
  });

  // Populates `document_tags` and metadata, so the new document resolves with
  // its tags (e.g. as a definition, and therefore previews) without waiting
  // for its first save.
  await syncDocumentMetadata({ documentId: created.id, markdown: input.markdown });
  revalidatePath("/", "layout");

  return { documentId: created.id, title };
}

/**
 * The user's own folders as display paths, for a `folder` settings field.
 * Owned folders only: a setting is a personal default, and offering a
 * collaborator's folder would make a stale setting the common case.
 */
export async function listOwnedFolderOptionsForUser(userId: string) {
  const rows = await db
    .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
    .from(folders)
    .where(and(eq(folders.ownerId, userId), isNull(folders.deletedAt)))
    .orderBy(folders.name);
  const paths = buildFolderPaths(rows);

  return rows
    .map((row) => ({ id: row.id, path: paths.get(row.id) ?? row.name }))
    .sort((first, second) => first.path.localeCompare(second.path));
}

/** Generic document options for extension settings (owned, non-Bin only). */
export async function listOwnedDocumentOptionsForUser(userId: string) {
  const rows = await db.select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), isNull(documents.deletedAt)))
    .orderBy(documents.title, documents.id);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.title.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    title: counts.get(row.title.toLocaleLowerCase())! > 1
      ? `${row.title} · ${row.id.slice(0, 8)}`
      : row.title,
  }));
}

export async function isOwnedDocumentForUser(userId: string, documentId: string): Promise<boolean> {
  const [row] = await db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, userId), isNull(documents.deletedAt)))
    .limit(1);
  return Boolean(row);
}
