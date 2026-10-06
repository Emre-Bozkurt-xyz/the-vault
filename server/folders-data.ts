/**
 * Data access for `@/server/folders`, for callers that have already
 * authenticated the user.
 *
 * These functions take a `userId` and trust it. They live here, in a module with
 * **no** `"use server"` directive, because every export of such a module is
 * registered as a callable server action — and as endpoints their only protection
 * would be that no client bundle happens to contain their action id. Never add the
 * directive to this file, and never accept a user id in an action.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, folderPermissions, folders, users } from "@/db/schema";
import { buildFolderPaths } from "@/lib/folder-paths";
import { canEditDocument, canEditFolderContents } from "@/lib/permissions";
import { syncDocumentMetadata } from "@/server/content-metadata";

export async function listFoldersForUser(userId: string) {
  return db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .where(and(eq(folders.ownerId, userId), isNull(folders.deletedAt)))
    .orderBy(asc(folders.sortOrder), asc(folders.name));
}

export async function listSharedFoldersForUser(userId: string) {
  const rows = await db.execute<{
    id: string;
    name: string;
    parentId: string | null;
    ownerId: string;
    ownerName: string | null;
    ownerUsername: string | null;
    rank: number;
  }>(sql`
    with recursive accessible as (
      select
        f.id, f.parent_id, f.name, f.owner_id,
        case when fp.role = 'editor' then 2 else 1 end as rank
      from ${folders} f
      join ${folderPermissions} fp
        on fp.folder_id = f.id and fp.user_id = ${userId}
      where f.deleted_at is null
      union all
      select c.id, c.parent_id, c.name, c.owner_id, a.rank
      from ${folders} c
      join accessible a on c.parent_id = a.id
      where c.deleted_at is null
    )
    select
      a.id as "id",
      a.name as "name",
      a.parent_id as "parentId",
      a.owner_id as "ownerId",
      u.name as "ownerName",
      u.username as "ownerUsername",
      max(a.rank) as "rank"
    from accessible a
    join ${users} u on u.id = a.owner_id
    group by a.id, a.name, a.parent_id, a.owner_id, u.name, u.username
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    ownerUsername: row.ownerUsername,
    role: (Number(row.rank) >= 2 ? "editor" : "viewer") as "editor" | "viewer",
  }));
}

export type AccessibleFolder = {
  id: string;
  name: string;
  parentId: string | null;
  /** Display path ("Courses/CS101"), resolved against visible folders only. */
  path: string;
  /** `owner` for the user's own folders; the share role otherwise. */
  access: "owner" | "editor" | "viewer";
  /** Set only for folders someone else owns. */
  ownerUsername: string | null;
};

/**
 * Every folder the user can see — owned plus shared (with descendants) — with
 * display paths, sorted by path. An owned folder wins over a share of itself.
 */
export async function listAccessibleFoldersForUser(
  userId: string,
): Promise<AccessibleFolder[]> {
  const [owned, shared] = await Promise.all([
    listFoldersForUser(userId),
    listSharedFoldersForUser(userId),
  ]);
  const ownedIds = new Set(owned.map((folder) => folder.id));
  const nodes = [
    ...owned.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      access: "owner" as const,
      ownerUsername: null,
    })),
    ...shared
      .filter((folder) => !ownedIds.has(folder.id))
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        access: folder.role,
        ownerUsername: folder.ownerUsername,
      })),
  ];
  const paths = buildFolderPaths(nodes);

  return nodes
    .map((folder) => ({ ...folder, path: paths.get(folder.id) ?? folder.name }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const folderNameLimit = 120;

/**
 * Creates a folder the user owns, at the root or inside another folder they
 * own (folder editors manage contents, not structure — the sidebar's rule).
 * Returns null when the parent is not theirs.
 */
export async function createFolderForUser(
  userId: string,
  input: { name: string; parentId?: string | null },
): Promise<{ id: string } | null> {
  const name = input.name.trim().slice(0, folderNameLimit);

  if (!name) {
    throw new Error("Folder name is required.");
  }

  const parentId = input.parentId ?? null;

  if (parentId) {
    const [parent] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.id, parentId),
          eq(folders.ownerId, userId),
          isNull(folders.deletedAt),
        ),
      )
      .limit(1);

    if (!parent) {
      return null;
    }
  }

  const [created] = await db
    .insert(folders)
    .values({ ownerId: userId, parentId, name })
    .returning({ id: folders.id });

  return { id: created.id };
}

/**
 * Files a document into a folder, or at the vault root when `folderId` is null.
 * Needs edit access to the document and, for a folder, the right to add to it
 * (owner or folder editor). Re-syncs the document's inherited folder tags.
 * Returns false when either check fails.
 */
export async function moveDocumentToFolderForUser(
  userId: string,
  documentId: string,
  folderId: string | null,
): Promise<boolean> {
  if (!(await canEditDocument(userId, documentId))) {
    return false;
  }

  if (folderId && !(await canEditFolderContents(userId, folderId))) {
    return false;
  }

  await db
    .update(documents)
    .set({ folderId, updatedAt: sql`now()` })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));

  await resyncDocumentTags([documentId]);
  return true;
}

/**
 * Re-materializes `document_tags` for documents whose folder ancestry just
 * changed. Inherited tags are resolved at sync time rather than stored on the
 * document, so any mutation that moves a document between folders — or changes
 * what a folder contributes — has to replay the sync for everything affected.
 *
 * Sequential on purpose: these run after the structural write has already
 * committed, and a folder subtree is small enough that the ordering costs
 * nothing worth a connection storm.
 */
export async function resyncDocumentTags(documentIds: string[]) {
  if (documentIds.length === 0) {
    return;
  }

  const rows = await db
    .select({ id: documents.id, markdown: documents.markdown })
    .from(documents)
    .where(inArray(documents.id, documentIds));

  for (const row of rows) {
    await syncDocumentMetadata({
      documentId: row.id,
      markdown: row.markdown,
    });
  }
}
