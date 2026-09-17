import { sql } from "drizzle-orm";

import { db } from "@/db";
import { normalizeTagList } from "@/lib/content-metadata";

/**
 * Folder default tags: tags a folder hands down to every document inside it,
 * subfolders included.
 *
 * They are deliberately *not* written into a document's frontmatter. The
 * document's Markdown stays the author's own text — moving a file between
 * folders must never rewrite its body — so inheritance is resolved here on
 * every metadata sync and materialized only into `document_tags`, which is
 * what search and the gallery read. The Properties panel shows them as
 * read-only chips so the author can see what the folder is contributing.
 *
 * Because the tags live in the folder tree rather than in the document, every
 * mutation that changes a document's ancestry — editing a folder's defaults,
 * moving a folder, moving or unfiling a document — has to re-sync the affected
 * documents. `server/folders.ts` owns those call sites.
 */

/** Depth cap for the ancestry walk; also the guard against a `parent_id` cycle. */
const maxFolderDepth = 64;

/**
 * The tags a document inherits from the folder holding it and that folder's
 * ancestors, nearest folder first. Returns an empty list for a document at the
 * vault root.
 *
 * Deleted folders are skipped, which also truncates the walk: a document under
 * a soft-deleted ancestor stops inheriting from above it, matching what the
 * sidebar shows.
 */
export async function resolveInheritedTagsForDocument(
  documentId: string,
): Promise<string[]> {
  const rows = await db.execute<{ depth: number; defaultTags: unknown }>(sql`
    with recursive ancestry as (
      select f.id, f.parent_id, f.default_tags, 0 as depth
      from folders f
      join documents d on d.folder_id = f.id
      where d.id = ${documentId} and f.deleted_at is null
      union all
      select p.id, p.parent_id, p.default_tags, a.depth + 1
      from folders p
      join ancestry a on p.id = a.parent_id
      where p.deleted_at is null and a.depth < ${maxFolderDepth}
    )
    select depth as "depth", default_tags as "defaultTags"
    from ancestry
    order by depth asc
  `);

  return normalizeTagList(rows.flatMap((row) => normalizeTagList(row.defaultTags)));
}

/**
 * The tags a folder inherits from its ancestors, nearest first — what the
 * folder settings panel shows as already-applied, above the folder's own
 * editable defaults. A folder's own `defaultTags` are deliberately excluded.
 */
export async function resolveInheritedTagsForFolder(
  folderId: string,
): Promise<string[]> {
  const rows = await db.execute<{ depth: number; defaultTags: unknown }>(sql`
    with recursive ancestry as (
      select p.id, p.parent_id, p.default_tags, 0 as depth
      from folders child
      join folders p on p.id = child.parent_id
      where child.id = ${folderId} and p.deleted_at is null
      union all
      select g.id, g.parent_id, g.default_tags, a.depth + 1
      from folders g
      join ancestry a on g.id = a.parent_id
      where g.deleted_at is null and a.depth < ${maxFolderDepth}
    )
    select depth as "depth", default_tags as "defaultTags"
    from ancestry
    order by depth asc
  `);

  return normalizeTagList(rows.flatMap((row) => normalizeTagList(row.defaultTags)));
}

/**
 * A document's effective tag set: what it declares in frontmatter first, then
 * whatever its folders add. Order matters only for display — `document_tags`
 * is a set — but putting the author's own tags first keeps the panel readable.
 */
export function mergeDocumentTags(
  ownTags: string[],
  inheritedTags: string[],
): string[] {
  return normalizeTagList([...ownTags, ...inheritedTags]);
}
