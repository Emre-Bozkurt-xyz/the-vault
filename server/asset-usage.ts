import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { assets, documentAssets, documentExtensionStates, documents } from "@/db/schema";
import { serverExtensions } from "@/extensions/registry.server";
import { findEmbedLine } from "@/lib/asset-embeds";
import { canReadDocument } from "@/lib/permissions";

/**
 * Which documents use a user's files, for the warning before binning or
 * deleting them and the "Used in" list in Details. Two sources:
 *
 * - Embeds in the document text (`document_assets`, kept current on every
 *   save). The first line holding the embed (`![[asset:<id>…]]`) is returned
 *   so the link can jump to it.
 * - Extension state that refers to files (a sticker's image): any extension
 *   whose state declaration has `assetIds` (`lib/extension-api/server.ts`) is
 *   searched, with no per-extension code here. These name the extension
 *   (`via`) and have no line.
 *
 * Documents the user can't open are counted, never named; documents in the
 * Bin are skipped. Data access only: trusts `ownerId`. The route checks the
 * session.
 */

export type AssetUsageDocument = {
  id: string;
  title: string;
  /** 0-based line of the first embed, or null if it can't be found in the text. */
  line: number | null;
  /** That line's text, to find it again if the document moved on. */
  text: string | null;
  /** The extension using the file here (its name), or null for an embed in the text. */
  via: string | null;
  /** For an extension use: what to ask its layer to show (`useRevealRequest`). */
  reveal: { extensionId: string; locator: string } | null;
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

type UsageRef = {
  assetId: string;
  documentId: string;
  title: string;
  via: string | null;
  reveal: { extensionId: string; locator: string } | null;
};

/** Extension state declarations that can say which files they use. */
function assetStateSources() {
  return serverExtensions.flatMap(({ manifest, server }) =>
    (server?.state ?? [])
      .filter((declaration) => typeof declaration.assetIds === "function")
      .map((declaration) => ({
        extensionId: manifest.id,
        name: manifest.name,
        stateKey: declaration.key ?? "default",
        declaration,
      })),
  );
}

/** Files used through extension state, found by each extension's own `assetIds`. */
async function extensionRefs(ids: string[]): Promise<UsageRef[]> {
  const wanted = new Set(ids);
  // A cheap text match narrows the rows; the extension's schema and
  // `assetIds` then decide exactly.
  const patterns = ids.map((id) => `%${id}%`);
  const refs: UsageRef[] = [];
  for (const source of assetStateSources()) {
    const rows = await db
      .select({
        documentId: documents.id,
        title: documents.title,
        state: documentExtensionStates.state,
      })
      .from(documentExtensionStates)
      .innerJoin(documents, eq(documents.id, documentExtensionStates.documentId))
      .where(
        and(
          eq(documentExtensionStates.extensionId, source.extensionId),
          eq(documentExtensionStates.stateKey, source.stateKey),
          isNull(documentExtensionStates.deletedAt),
          isNull(documents.deletedAt),
          sql`${documentExtensionStates.state}::text like any (array[${sql.join(
            patterns.map((pattern) => sql`${pattern}`),
            sql`, `,
          )}])`,
        ),
      )
      .limit(MAX_DOCUMENTS * 4);
    for (const row of rows) {
      const parsed = source.declaration.schema.safeParse(row.state);
      if (!parsed.success) continue;
      let used: ReturnType<NonNullable<typeof source.declaration.assetIds>> = [];
      try {
        used = source.declaration.assetIds!(parsed.data);
      } catch {
        // A broken extractor must not break deleting files.
        continue;
      }
      // The first use of each file in this document is the one to reveal.
      const found = new Map<string, string | null>();
      for (const entry of used) {
        const use = typeof entry === "string" ? { assetId: entry } : entry;
        if (typeof use?.assetId !== "string" || !wanted.has(use.assetId) || found.has(use.assetId)) continue;
        found.set(use.assetId, typeof use.locator === "string" ? use.locator : null);
      }
      for (const [assetId, locator] of found) {
        refs.push({
          assetId,
          documentId: row.documentId,
          title: row.title,
          via: source.name,
          reveal: locator ? { extensionId: source.extensionId, locator } : null,
        });
      }
    }
  }
  return refs;
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

  const embeds = await db
    .select({
      assetId: documentAssets.assetId,
      documentId: documents.id,
      title: documents.title,
    })
    .from(documentAssets)
    .innerJoin(documents, eq(documents.id, documentAssets.documentId))
    // A document in its Bin doesn't show the file to anyone.
    .where(and(inArray(documentAssets.assetId, ids), isNull(documents.deletedAt)))
    .limit(MAX_DOCUMENTS * 4);
  const refs: UsageRef[] = [
    ...embeds.map((embed) => ({ ...embed, via: null, reveal: null })),
    ...(await extensionRefs(ids)),
  ];
  if (refs.length === 0) return [];

  const names = new Map<string, string>();
  const nameRows = await db
    .select({ id: assets.id, name: assets.displayName })
    .from(assets)
    .where(inArray(assets.id, [...new Set(refs.map((ref) => ref.assetId))]));
  for (const row of nameRows) names.set(row.id, row.name);

  const documentIds = [...new Set(refs.map((ref) => ref.documentId))].slice(0, MAX_DOCUMENTS);
  const readable = new Set<string>();
  for (const documentId of documentIds) {
    if (await canReadDocument(ownerId, documentId)) readable.add(documentId);
  }
  // Only embeds need the text, to find their line.
  const bodies = new Map<string, string>();
  const needBodies = [...readable].filter((id) => refs.some((ref) => ref.documentId === id && ref.via === null));
  if (needBodies.length > 0) {
    const rows = await db
      .select({ id: documents.id, markdown: documents.markdown })
      .from(documents)
      .where(inArray(documents.id, needBodies));
    for (const row of rows) bodies.set(row.id, row.markdown);
  }

  const byAsset = new Map<string, AssetUsage & { seen: Set<string> }>();
  for (const ref of refs) {
    let usage = byAsset.get(ref.assetId);
    if (!usage) {
      usage = { assetId: ref.assetId, name: names.get(ref.assetId) ?? "File", documents: [], hidden: 0, seen: new Set() };
      byAsset.set(ref.assetId, usage);
    }
    const key = `${ref.documentId}:${ref.via ?? ""}`;
    if (usage.seen.has(key)) continue;
    usage.seen.add(key);
    if (!readable.has(ref.documentId)) {
      usage.hidden += 1;
      continue;
    }
    const found = ref.via === null ? findEmbedLine(bodies.get(ref.documentId) ?? "", ref.assetId) : null;
    usage.documents.push({
      id: ref.documentId,
      title: ref.title || "Untitled",
      line: found?.line ?? null,
      text: found?.text ?? null,
      via: ref.via,
      reveal: ref.reveal,
    });
  }

  return [...byAsset.values()]
    .map((usage) => ({
      assetId: usage.assetId,
      name: usage.name,
      hidden: usage.hidden,
      documents: usage.documents.sort(
        (a, b) => a.title.localeCompare(b.title) || (a.via ?? "").localeCompare(b.via ?? ""),
      ),
    }))
    .sort((a, b) => b.documents.length + b.hidden - (a.documents.length + a.hidden));
}
