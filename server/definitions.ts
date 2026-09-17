"use server";

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
import { updateDocumentMetadataFrontmatter } from "@/lib/content-metadata";
import { definitionTagSlug } from "@/lib/definitions";
import { buildFolderPaths } from "@/lib/folder-paths";
import { canEditFolderContents } from "@/lib/permissions";
import { syncDocumentMetadata } from "@/server/content-metadata";
import { requireActiveUser } from "@/server/authz";

/**
 * Creating definition documents for the `/def` slash command
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md` slice 4).
 *
 * Kept out of `server/documents.ts` because everything exported from a
 * `"use server"` module is a callable endpoint, and this one has a narrow
 * contract worth reading in one place.
 */

const termSchema = z.string().trim().min(1).max(200);
const folderIdSchema = z.string().uuid();

export type CreateDefinitionResult =
  | {
      ok: true;
      documentId: string;
      title: string;
      /** False when an existing definition was reused. */
      created: boolean;
    }
  | { ok: false; message: string };

const summarySchema = z.string().trim().max(500);

/**
 * Finds or creates the definition document for `term`.
 *
 * Reuses an existing one the author owns with the same title, rather than
 * minting a second: `/def` on a term already defined has to mean "link me to
 * it", or the vault quietly accumulates duplicate definitions whose wiki links
 * then resolve as `ambiguous`.
 *
 * `currentFolderId` is the folder of the document being written in. The author's
 * configured folder wins when set, but a folder they can no longer file into
 * falls back rather than failing — a stale preference must not break authoring.
 */
export async function createDefinitionDocumentAction(input: {
  term: string;
  currentFolderId?: string | null;
  preferredFolderId?: string | null;
}): Promise<CreateDefinitionResult> {
  const user = await requireActiveUser();
  return createDefinitionForUser(user.id, input);
}

/**
 * The same thing for an already-resolved user, so the agent-action dispatcher
 * (`server/extensions.ts`) can offer definition creation without re-resolving a
 * session it has already authenticated.
 */
export async function createDefinitionForUser(
  userId: string,
  input: {
    term: string;
    /** Seeds the document's `summary:`, which is the hover text readers see. */
    summary?: string | null;
    currentFolderId?: string | null;
    preferredFolderId?: string | null;
  },
): Promise<CreateDefinitionResult> {
  const parsedTerm = termSchema.safeParse(input.term);

  if (!parsedTerm.success) {
    return { ok: false, message: "A definition needs a term." };
  }

  const term = parsedTerm.data;
  const summary = input.summary
    ? summarySchema.safeParse(input.summary).data ?? null
    : null;
  const [existing] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        isNull(documents.deletedAt),
        ilike(documents.title, term.replace(/[%_]/g, "\\$&")),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      ok: true,
      documentId: existing.id,
      title: existing.title,
      created: false,
    };
  }

  const folderId = await resolveDefinitionFolderId(userId, input);
  // Built through the shared serializer rather than by hand, so a summary with a
  // colon or a quote in it is escaped exactly the way the Properties panel would
  // have escaped it. The tag is written even when the folder would supply it, so
  // the document stays a definition if it is later moved somewhere that would not.
  const markdown = updateDocumentMetadataFrontmatter("", {
    tags: [definitionTagSlug],
    aliases: [],
    summary,
    status: null,
    project: null,
  });

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({ ownerId: userId, folderId, title: term, markdown })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: row.id,
      userId,
      role: "owner",
    });

    return [row];
  });

  // Populates `document_tags`, which is what makes the new document resolve as a
  // definition (and therefore preview) without waiting for its first save.
  await syncDocumentMetadata({ documentId: created.id, markdown });

  revalidatePath("/", "layout");

  return { ok: true, documentId: created.id, title: term, created: true };
}

/**
 * Folders the user can file a definition into, as display paths, for the
 * settings picker. Owned folders only: the setting is a personal default, and
 * offering a collaborator's folder would make a stale preference the common case
 * rather than the edge one.
 */
export async function listDefinitionFolderOptions() {
  const user = await requireActiveUser();
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
    })
    .from(folders)
    .where(and(eq(folders.ownerId, user.id), isNull(folders.deletedAt)))
    .orderBy(folders.name);
  const paths = buildFolderPaths(rows);

  return rows
    .map((row) => ({ id: row.id, path: paths.get(row.id) ?? row.name }))
    .sort((first, second) => first.path.localeCompare(second.path));
}

async function resolveDefinitionFolderId(
  userId: string,
  input: { currentFolderId?: string | null; preferredFolderId?: string | null },
) {
  const preferred = folderIdSchema.safeParse(input.preferredFolderId);

  if (preferred.success && (await canEditFolderContents(userId, preferred.data))) {
    return preferred.data;
  }

  const current = folderIdSchema.safeParse(input.currentFolderId);

  if (current.success && (await canEditFolderContents(userId, current.data))) {
    return current.data;
  }

  return null;
}

/**
 * Every definition document the user can read — their own, shared with them, or
 * public — with its aliases and summary.
 *
 * Read-access scoping mirrors `listWikiLinkResolutionsForUser`: a definition the
 * user cannot open must not appear in a glossary listing either.
 */
export async function listDefinitionsForUser(userId: string) {
  const rows = await db
    .selectDistinct({
      documentId: documents.id,
      term: documents.title,
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
        eq(tags.slug, definitionTagSlug),
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
    term: row.term,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    summary: row.summary ?? null,
  }));
}
