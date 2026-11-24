import "server-only";

import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { assetFolders, assetShareLinks, assets, users } from "@/db/schema";
import { decodeShareToken, encodeShareToken, shareTokenSecret } from "@/lib/share-token";
import { AssetError, buildAssetRenditionUrls } from "@/server/assets";
import { isUserBanActive } from "@/server/authz";

/**
 * Media share links (docs/26 §9): anyone with the link can view a folder's
 * live subtree or a single asset on `/s/<token>`, without an account. Every
 * public read re-checks, at request time, that the link is unrevoked and
 * unexpired, its owner isn't banned, its target is live, and the requested
 * file or subfolder is inside the shared target — the same 404 for any miss.
 */

export const MAX_EXPIRY_DAYS = 365;
/** Most files one "Download all" zip may hold. */
export const MAX_ZIP_FILES = 5000;

export type ShareTarget = { folderId: string } | { assetId: string };

type LinkRow = typeof assetShareLinks.$inferSelect;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new AssetError("Not found.", 404, "SHARE_LINK_NOT_FOUND");
}

export function shareLinkPath(linkId: string) {
  return `/s/${encodeShareToken(linkId, shareTokenSecret())}`;
}

function present(link: LinkRow) {
  return {
    id: link.id,
    path: shareLinkPath(link.id),
    allowDownload: link.allowDownload,
    expiresAt: link.expiresAt,
    expired: link.expiresAt !== null && link.expiresAt <= new Date(),
    createdAt: link.createdAt,
    lastViewedAt: link.lastViewedAt,
  };
}

export type ShareLinkView = ReturnType<typeof present>;

function expiryFrom(days: unknown): Date | null {
  if (days === null || days === undefined) return null;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new AssetError(`Expiry must be 1–${MAX_EXPIRY_DAYS} days, or none.`, 400, "INVALID_EXPIRY");
  }
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Validates a target the owner wants to share: theirs, and live. */
async function requireShareableTarget(userId: string, target: ShareTarget) {
  if ("folderId" in target) {
    if (!uuid.test(target.folderId)) throw notFound();
    const [folder] = await db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(
        and(
          eq(assetFolders.id, target.folderId),
          eq(assetFolders.ownerId, userId),
          eq(assetFolders.status, "active"),
        ),
      )
      .limit(1);
    if (!folder) throw notFound();
    return;
  }
  if (!uuid.test(target.assetId)) throw notFound();
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, target.assetId),
        eq(assets.ownerId, userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);
  if (!asset) throw notFound();
}

function targetCondition(target: ShareTarget) {
  return "folderId" in target
    ? eq(assetShareLinks.folderId, target.folderId)
    : eq(assetShareLinks.assetId, target.assetId);
}

/** The target's current (unrevoked) link, expired or not, or null. */
export async function getShareLinkForTarget(userId: string, target: ShareTarget) {
  const [link] = await db
    .select()
    .from(assetShareLinks)
    .where(
      and(
        eq(assetShareLinks.ownerId, userId),
        isNull(assetShareLinks.revokedAt),
        targetCondition(target),
      ),
    )
    .limit(1);
  return link ? present(link) : null;
}

/**
 * Turns link sharing on for a target, or updates its settings if it is
 * already on (the same URL keeps working). One live link per target is a
 * database constraint, so a double click can't create two.
 */
export async function upsertShareLink(input: {
  userId: string;
  target: ShareTarget;
  allowDownload: boolean;
  expiresInDays: number | null;
}) {
  await requireShareableTarget(input.userId, input.target);
  const expiresAt = expiryFrom(input.expiresInDays);
  const now = new Date();
  const isFolder = "folderId" in input.target;

  const [link] = await db
    .insert(assetShareLinks)
    .values({
      ownerId: input.userId,
      folderId: isFolder ? (input.target as { folderId: string }).folderId : null,
      assetId: isFolder ? null : (input.target as { assetId: string }).assetId,
      allowDownload: input.allowDownload,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: isFolder ? assetShareLinks.folderId : assetShareLinks.assetId,
      targetWhere: isFolder
        ? sql`${assetShareLinks.revokedAt} is null and ${assetShareLinks.folderId} is not null`
        : sql`${assetShareLinks.revokedAt} is null and ${assetShareLinks.assetId} is not null`,
      set: { allowDownload: input.allowDownload, expiresAt, updatedAt: now },
    })
    .returning();
  return present(link);
}

async function requireOwnLiveLink(userId: string, linkId: string) {
  if (!uuid.test(linkId)) throw notFound();
  const [link] = await db
    .select()
    .from(assetShareLinks)
    .where(
      and(
        eq(assetShareLinks.id, linkId),
        eq(assetShareLinks.ownerId, userId),
        isNull(assetShareLinks.revokedAt),
      ),
    )
    .limit(1);
  if (!link) throw notFound();
  return link;
}

/** Stops the link working, at once. */
export async function revokeShareLink(userId: string, linkId: string) {
  await requireOwnLiveLink(userId, linkId);
  await db
    .update(assetShareLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assetShareLinks.id, linkId), isNull(assetShareLinks.revokedAt)));
}

/** New URL, same settings; the old one stops working. */
export async function resetShareLink(userId: string, linkId: string) {
  const link = await requireOwnLiveLink(userId, linkId);
  const [fresh] = await db.transaction(async (tx) => {
    await tx
      .update(assetShareLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(assetShareLinks.id, link.id));
    return tx
      .insert(assetShareLinks)
      .values({
        ownerId: link.ownerId,
        folderId: link.folderId,
        assetId: link.assetId,
        allowDownload: link.allowDownload,
        expiresAt: link.expiresAt,
      })
      .returning();
  });
  return present(fresh);
}

/** Ids of the user's folders and assets that have a working link (for badges). */
export async function listSharedTargetsForUser(userId: string) {
  const rows = await db
    .select({ folderId: assetShareLinks.folderId, assetId: assetShareLinks.assetId })
    .from(assetShareLinks)
    .where(
      and(
        eq(assetShareLinks.ownerId, userId),
        isNull(assetShareLinks.revokedAt),
        or(isNull(assetShareLinks.expiresAt), gt(assetShareLinks.expiresAt, new Date())),
      ),
    );
  return {
    folderIds: rows.flatMap((row) => (row.folderId ? [row.folderId] : [])),
    assetIds: rows.flatMap((row) => (row.assetId ? [row.assetId] : [])),
  };
}

// ── Public side ────────────────────────────────────────────────────────────

export type ResolvedShare = {
  link: LinkRow;
  ownerName: string;
  /** The shared folder, for folder links. */
  folder: { id: string; name: string } | null;
};

/**
 * The working link a token names, or null: unknown, forged, revoked,
 * expired, owner banned, or its folder/asset binned or deleted.
 */
export async function resolveShareToken(token: unknown): Promise<ResolvedShare | null> {
  const linkId = decodeShareToken(token, shareTokenSecret());
  if (!linkId) return null;

  const [row] = await db
    .select({
      link: assetShareLinks,
      ownerName: users.name,
      ownerUsername: users.username,
      bannedAt: users.bannedAt,
      bannedUntil: users.bannedUntil,
      folderName: assetFolders.name,
      folderStatus: assetFolders.status,
      assetStatus: assets.status,
      assetDeletedAt: assets.deletedAt,
    })
    .from(assetShareLinks)
    .innerJoin(users, eq(users.id, assetShareLinks.ownerId))
    .leftJoin(assetFolders, eq(assetFolders.id, assetShareLinks.folderId))
    .leftJoin(assets, eq(assets.id, assetShareLinks.assetId))
    .where(eq(assetShareLinks.id, linkId))
    .limit(1);

  if (!row || row.link.revokedAt) return null;
  if (row.link.expiresAt && row.link.expiresAt <= new Date()) return null;
  if (isUserBanActive({ bannedAt: row.bannedAt, bannedUntil: row.bannedUntil })) return null;
  if (row.link.folderId && row.folderStatus !== "active") return null;
  if (row.link.assetId && (row.assetStatus !== "ready" || row.assetDeletedAt)) return null;

  return {
    link: row.link,
    ownerName: row.ownerName ?? row.ownerUsername ?? "A Vault user",
    folder: row.link.folderId && row.folderName ? { id: row.link.folderId, name: row.folderName } : null,
  };
}

/** Records a visit, at most once an hour per link. */
export async function touchShareLink(linkId: string) {
  await db
    .update(assetShareLinks)
    .set({ lastViewedAt: new Date() })
    .where(
      and(
        eq(assetShareLinks.id, linkId),
        or(
          isNull(assetShareLinks.lastViewedAt),
          sql`${assetShareLinks.lastViewedAt} < now() - interval '1 hour'`,
        ),
      ),
    );
}

/**
 * Whether `folderId` is the shared folder or below it, walking up through
 * live folders only. A folder's live ancestors are never binned (binning is
 * eager), so this is also a liveness check.
 */
export async function isFolderInShare(share: ResolvedShare, folderId: string) {
  if (!share.link.folderId || !uuid.test(folderId)) return false;
  if (folderId === share.link.folderId) return true;

  const rows = await db.execute<{ found: number }>(sql`
    with recursive up(id, parent_id) as (
      select id, parent_id from asset_folders
      where id = ${folderId} and owner_id = ${share.link.ownerId} and status = 'active'
      union all
      select f.id, f.parent_id from asset_folders f
      join up on f.id = up.parent_id
      where f.status = 'active'
    )
    select 1 as found from up where id = ${share.link.folderId} limit 1
  `);
  return [...rows].length > 0;
}

/**
 * The asset, if this share reaches it: the shared asset itself, or a live
 * asset of the owner inside the shared folder's subtree. Shaped like
 * `getReadableAsset` so the content route serves it the same way (always as
 * private for caching).
 */
export async function getAssetViaShare(share: ResolvedShare, assetId: string) {
  if (!uuid.test(assetId)) return null;
  const [asset] = await db
    .select({
      id: assets.id,
      ownerId: assets.ownerId,
      folderId: assets.folderId,
      storageKey: assets.storageKey,
      displayName: assets.displayName,
      kind: assets.kind,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      status: assets.status,
      deletedAt: assets.deletedAt,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.ownerId, share.link.ownerId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);
  if (!asset) return null;

  const reached = share.link.assetId
    ? share.link.assetId === asset.id
    : asset.folderId !== null && (await isFolderInShare(share, asset.folderId));
  return reached ? { ...asset, visibility: "private" as const } : null;
}

/** Content URLs for a shared asset: everything carries the token as `?s=`. */
export function sharedAssetUrls(
  token: string,
  asset: Parameters<typeof buildAssetRenditionUrls>[0],
) {
  const withToken = (url: string | null) =>
    url ? `${url}${url.includes("?") ? "&" : "?"}s=${encodeURIComponent(token)}` : null;
  const { thumbUrl, displayUrl } = buildAssetRenditionUrls(asset);
  return {
    url: withToken(`/api/assets/${asset.id}/content`)!,
    thumbUrl: withToken(thumbUrl),
    displayUrl: withToken(displayUrl),
  };
}

const sharedAssetColumns = {
  id: assets.id,
  kind: assets.kind,
  displayName: assets.displayName,
  description: assets.description,
  altText: assets.altText,
  mimeType: assets.mimeType,
  sizeBytes: assets.sizeBytes,
  createdAt: assets.createdAt,
  width: assets.width,
  height: assets.height,
  takenAt: assets.takenAt,
  durationMs: assets.durationMs,
  folderId: assets.folderId,
  renditionStatus: assets.renditionStatus,
  renditionVersion: assets.renditionVersion,
};

type SharedAssetRow = {
  [K in keyof typeof sharedAssetColumns]: (typeof assets.$inferSelect)[K & keyof typeof assets.$inferSelect];
};

function presentSharedAsset(token: string, row: SharedAssetRow) {
  // Rendition state is internal: the page gets URLs, not the bookkeeping.
  const rest: Partial<SharedAssetRow> = { ...row };
  delete rest.renditionStatus;
  delete rest.renditionVersion;
  return {
    ...(rest as Omit<SharedAssetRow, "renditionStatus" | "renditionVersion">),
    ...sharedAssetUrls(token, row),
    visibility: "private" as const,
    tags: [] as string[],
    markdown: "",
  };
}

export type SharedAsset = ReturnType<typeof presentSharedAsset>;

/** The one shared asset, presented for the public page. */
export async function getSharedSingleAsset(share: ResolvedShare, token: string) {
  if (!share.link.assetId) return null;
  const [row] = await db
    .select(sharedAssetColumns)
    .from(assets)
    .where(and(eq(assets.id, share.link.assetId), eq(assets.status, "ready"), isNull(assets.deletedAt)))
    .limit(1);
  return row ? presentSharedAsset(token, row) : null;
}

/**
 * One folder of a shared tree: its path from the shared root, its live
 * subfolders (with direct counts) and its live files, in the order they were
 * taken (an event's order), falling back to upload order.
 */
export async function listSharedFolder(share: ResolvedShare, token: string, folderId: string) {
  if (!(await isFolderInShare(share, folderId))) return null;

  const pathRows = await db.execute<{ id: string; name: string; depth: number }>(sql`
    with recursive up(id, parent_id, name, depth) as (
      select id, parent_id, name, 0 from asset_folders where id = ${folderId}
      union all
      select f.id, f.parent_id, f.name, up.depth + 1 from asset_folders f
      join up on f.id = up.parent_id
      where up.id <> ${share.link.folderId}
    )
    select id, name, depth from up order by depth desc
  `);
  const path = [...pathRows].map((row) => ({ id: row.id, name: row.name }));

  const [subfolders, files] = await Promise.all([
    db
      .select({
        id: assetFolders.id,
        name: assetFolders.name,
        files: sql<number>`(select count(*)::int from assets a where a.folder_id = "asset_folders"."id" and a.status = 'ready' and a.deleted_at is null)`,
        folders: sql<number>`(select count(*)::int from asset_folders sub where sub.parent_id = "asset_folders"."id" and sub.status = 'active')`,
      })
      .from(assetFolders)
      .where(and(eq(assetFolders.parentId, folderId), eq(assetFolders.status, "active")))
      .orderBy(asc(assetFolders.name)),
    db
      .select(sharedAssetColumns)
      .from(assets)
      .where(and(eq(assets.folderId, folderId), eq(assets.status, "ready"), isNull(assets.deletedAt)))
      .orderBy(sql`coalesce(${assets.takenAt}, ${assets.createdAt})`, asc(assets.id)),
  ]);

  return {
    path,
    folders: subfolders,
    assets: files.map((row) => presentSharedAsset(token, row)),
  };
}

/**
 * Every live file under a shared folder, with its path relative to that
 * folder, for "Download all". Capped at MAX_ZIP_FILES + 1 so the caller can
 * tell "too many" apart from "exactly the limit".
 */
export async function listSharedSubtreeFiles(share: ResolvedShare, folderId: string) {
  if (!(await isFolderInShare(share, folderId))) return null;

  const rows = await db.execute<{
    id: string;
    display_name: string;
    storage_key: string;
    size_bytes: string | number;
    path: string;
  }>(sql`
    with recursive down(id, path) as (
      select id, ''::text from asset_folders where id = ${folderId} and status = 'active'
      union all
      select c.id, case when down.path = '' then c.name else down.path || '/' || c.name end
      from asset_folders c join down on c.parent_id = down.id
      where c.status = 'active'
    )
    select a.id, a.display_name, a.storage_key, a.size_bytes, down.path
    from assets a join down on a.folder_id = down.id
    where a.status = 'ready' and a.deleted_at is null
    order by down.path, a.display_name, a.id
    limit ${MAX_ZIP_FILES + 1}
  `);
  return [...rows].map((row) => ({
    id: row.id,
    displayName: row.display_name,
    storageKey: row.storage_key,
    sizeBytes: Number(row.size_bytes),
    path: row.path,
  }));
}
