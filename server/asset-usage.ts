import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { assets, documentAssets, documents } from "@/db/schema";
import { findEmbedLine } from "@/lib/asset-embeds";
import { canReadDocument } from "@/lib/permissions";

/**
 * Which documents embed a user's files (`document_assets`, kept current on
 * every document save), for the warning before binning or deleting them and
 * the "Used in" list in Details. Documents the user can't open are counted,
 * never named. For the rest, the first line holding the embed
 * (`![[asset:<id>…]]`) is returned so the link can jump to it.
 *
 * Data access only: trusts `ownerId`. The route checks the session.
 */

export type AssetUsageDocument = {
  id: string;
  title: string;
  /** 0-based line of the first embed, or null if it can't be found in the text. */
  line: number | null;
  /** That line's text, to find it again if the document moved on. */
  text: string | null;
};

export type AssetUsage = {
  assetId: string;
  name: string;
  documents: AssetUsageDocument[];
  /** Documents using it that this user can't open. */
  hidden: number;
};

/** Enough to read; beyond this the warning just says "and more". */
const MAX_DOCUMENTS = 60;

/** The owner's live files named directly or inside the folders' subtrees. */
async function resolveAssetIds(ownerId: string, assetIds: string[], folderIds: string[]) {
  const ids = new Set<string>();
  if (assetIds.length > 0) {
    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.ownerId, ownerId),
          inArray(assets.id, assetIds),
          inArray(assets.status, ["ready", "trashed"]),
          isNull(assets.deletedAt),
        ),
      );
    for (const row of rows) ids.add(row.id);
  }
  if (folderIds.length > 0) {
    const rows = await db.execute<{ id: string }>(sql`
      with recursive tree(id) as (
        select f.id from asset_folders f
        where f.owner_id = ${ownerId} and f.id in ${folderIds}
        union all
        select child.id from asset_folders child join tree on child.parent_id = tree.id
        where child.owner_id = ${ownerId}
      )
      select a.id from assets a
      where a.owner_id = ${ownerId} and a.folder_id in (select id from tree)
        and a.status in ('ready', 'trashed') and a.deleted_at is null
    `);
    for (const row of rows) ids.add(row.id);
  }
  return [...ids];
}

/**
 * Usage of the owner's files (and of everything inside the given folders).
 * Only files used somewhere are returned, most-used first.
 */
export async function getAssetUsageForOwner(
  ownerId: string,
  input: { assetIds?: string[]; folderIds?: string[] },
): Promise<AssetUsage[]> {
  const ids = await resolveAssetIds(ownerId, input.assetIds ?? [], input.folderIds ?? []);
  if (ids.length === 0) return [];

  const links = await db
    .select({
      assetId: documentAssets.assetId,
      assetName: assets.displayName,
      documentId: documents.id,
      title: documents.title,
    })
    .from(documentAssets)
    .innerJoin(documents, eq(documents.id, documentAssets.documentId))
    .innerJoin(assets, eq(assets.id, documentAssets.assetId))
    // A document in its Bin doesn't show the file to anyone.
    .where(and(inArray(documentAssets.assetId, ids), isNull(documents.deletedAt)))
    .limit(MAX_DOCUMENTS * 4);
  if (links.length === 0) return [];

  const documentIds = [...new Set(links.map((link) => link.documentId))].slice(0, MAX_DOCUMENTS);
  const readable = new Set<string>();
  for (const documentId of documentIds) {
    if (await canReadDocument(ownerId, documentId)) readable.add(documentId);
  }
  const bodies = new Map<string, string>();
  if (readable.size > 0) {
    const rows = await db
      .select({ id: documents.id, markdown: documents.markdown })
      .from(documents)
      .where(inArray(documents.id, [...readable]));
    for (const row of rows) bodies.set(row.id, row.markdown);
  }

  const byAsset = new Map<string, AssetUsage>();
  for (const link of links) {
    const usage =
      byAsset.get(link.assetId) ??
      byAsset.set(link.assetId, { assetId: link.assetId, name: link.assetName, documents: [], hidden: 0 }).get(link.assetId)!;
    if (!readable.has(link.documentId)) {
      usage.hidden += 1;
      continue;
    }
    const found = findEmbedLine(bodies.get(link.documentId) ?? "", link.assetId);
    usage.documents.push({
      id: link.documentId,
      title: link.title || "Untitled",
      line: found?.line ?? null,
      text: found?.text ?? null,
    });
  }

  return [...byAsset.values()]
    .map((usage) => ({ ...usage, documents: usage.documents.sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => b.documents.length + b.hidden - (a.documents.length + a.hidden));
}
