import "server-only";

import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { assetFolders, assets } from "@/db/schema";
import {
  MAX_FOLDER_DEPTH,
  checkFolderMove,
  folderDepth,
  folderNameKey,
  normalizeFolderName,
  uniqueFolderName,
  type FolderNode,
} from "@/lib/asset-folders";
import { binPurgeAt } from "@/lib/asset-lifecycle";
import {
  AssetError,
  deleteFolderBinAssetsForever,
  emptyAssetBinForUser,
} from "@/server/assets";

/**
 * The media library's folder tree (docs/26_MEDIA_LIBRARY_AND_FOLDERS_PLAN.md
 * §4.2, §6). Every structural change runs in a transaction holding a per-user
 * advisory lock and re-checks the move/name rules (`lib/asset-folders.ts`)
 * against the tree as it is inside that lock, so two concurrent requests —
 * in this process or another — can never build a cycle, exceed the depth
 * limit, or create sibling folders with the same name.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockTree(tx: Tx, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`asset_folders:${userId}`}, 0))`,
  );
}

async function loadLiveFolders(tx: Tx | typeof db, userId: string): Promise<FolderNode[]> {
  return tx
    .select({ id: assetFolders.id, parentId: assetFolders.parentId, name: assetFolders.name })
    .from(assetFolders)
    .where(and(eq(assetFolders.ownerId, userId), eq(assetFolders.status, "active")));
}

function notFound() {
  return new AssetError("Folder not found.", 404, "FOLDER_NOT_FOUND");
}

function nameTaken(name: string) {
  return new AssetError(`A folder named “${name}” already exists here.`, 409, "FOLDER_NAME_TAKEN");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: unknown } | null;
  return candidate?.code === "23505" || (candidate?.cause ? isUniqueViolation(candidate.cause) : false);
}

/** Runs a tree mutation; a unique-index hit that slipped past the checks is a 409. */
async function mutateTree<T>(userId: string, run: (tx: Tx) => Promise<T>) {
  try {
    return await db.transaction(async (tx) => {
      await lockTree(tx, userId);
      return run(tx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AssetError("A folder with that name already exists here.", 409, "FOLDER_NAME_TAKEN");
    }
    throw error;
  }
}

function requireName(raw: unknown) {
  const result = normalizeFolderName(raw);
  if (!result.ok) throw new AssetError(result.error, 400, "INVALID_FOLDER_NAME");
  return result.name;
}

function siblingNames(folders: FolderNode[], parentId: string | null, exceptId?: string) {
  return folders
    .filter((folder) => folder.parentId === parentId && folder.id !== exceptId)
    .map((folder) => folder.name);
}

/** The user's live folders, flat (the client builds the tree). */
export async function listFoldersForUser(userId: string) {
  return db
    .select({
      id: assetFolders.id,
      parentId: assetFolders.parentId,
      name: assetFolders.name,
      createdAt: assetFolders.createdAt,
      updatedAt: assetFolders.updatedAt,
    })
    .from(assetFolders)
    .where(and(eq(assetFolders.ownerId, userId), eq(assetFolders.status, "active")))
    .orderBy(asc(assetFolders.name));
}

/** For upload routes: 404 unless the folder is the user's and live. */
export async function requireLiveFolder(userId: string, folderId: string | null) {
  if (!folderId) return null;
  if (!isUuid(folderId)) throw notFound();

  const [folder] = await db
    .select({ id: assetFolders.id })
    .from(assetFolders)
    .where(
      and(
        eq(assetFolders.id, folderId),
        eq(assetFolders.ownerId, userId),
        eq(assetFolders.status, "active"),
      ),
    )
    .limit(1);
  if (!folder) throw notFound();
  return folder.id;
}

export async function createAssetFolder(input: {
  userId: string;
  name: unknown;
  parentId: string | null;
  /** `rename` picks "Name (2)" on a clash (folder drops); `error` answers 409. */
  onConflict?: "error" | "rename";
}) {
  const desired = requireName(input.name);
  if (input.parentId !== null && !isUuid(input.parentId)) throw notFound();

  return mutateTree(input.userId, async (tx) => {
    const folders = await loadLiveFolders(tx, input.userId);
    if (input.parentId && !folders.some((folder) => folder.id === input.parentId)) {
      throw notFound();
    }
    if (folderDepth(folders, input.parentId) + 1 > MAX_FOLDER_DEPTH) {
      throw new AssetError("Folders can't be nested that deep.", 400, "FOLDER_TOO_DEEP");
    }

    const taken = siblingNames(folders, input.parentId);
    const clash = taken.some((name) => folderNameKey(name) === folderNameKey(desired));
    if (clash && input.onConflict !== "rename") throw nameTaken(desired);
    const name = clash ? uniqueFolderName(desired, taken) : desired;

    const [created] = await tx
      .insert(assetFolders)
      .values({ ownerId: input.userId, parentId: input.parentId, name })
      .returning({
        id: assetFolders.id,
        parentId: assetFolders.parentId,
        name: assetFolders.name,
        createdAt: assetFolders.createdAt,
        updatedAt: assetFolders.updatedAt,
      });
    return created;
  });
}

export async function renameAssetFolder(input: { userId: string; folderId: string; name: unknown }) {
  const name = requireName(input.name);
  if (!isUuid(input.folderId)) throw notFound();

  return mutateTree(input.userId, async (tx) => {
    const folders = await loadLiveFolders(tx, input.userId);
    const folder = folders.find((candidate) => candidate.id === input.folderId);
    if (!folder) throw notFound();

    const clash = siblingNames(folders, folder.parentId, folder.id).some(
      (sibling) => folderNameKey(sibling) === folderNameKey(name),
    );
    if (clash) throw nameTaken(name);

    const [renamed] = await tx
      .update(assetFolders)
      .set({ name, updatedAt: new Date() })
      .where(eq(assetFolders.id, folder.id))
      .returning({ id: assetFolders.id, parentId: assetFolders.parentId, name: assetFolders.name });
    return renamed;
  });
}

const moveRefusal: Record<string, string> = {
  "into-itself": "A folder can't be moved into itself.",
  "too-deep": "Folders can't be nested that deep.",
};

/**
 * Moves assets and folders into `targetFolderId` (null = library root), all or
 * nothing. Assets must be the user's live assets; folders the user's live
 * folders, each checked for cycles, depth and name clashes against the tree as
 * the earlier moves in the same request left it. Items already there are
 * skipped, not errors.
 */
export async function moveAssetItems(input: {
  userId: string;
  assetIds: string[];
  folderIds: string[];
  targetFolderId: string | null;
}) {
  if (input.targetFolderId !== null && !isUuid(input.targetFolderId)) throw notFound();

  return mutateTree(input.userId, async (tx) => {
    const folders = await loadLiveFolders(tx, input.userId);
    if (input.targetFolderId && !folders.some((folder) => folder.id === input.targetFolderId)) {
      throw notFound();
    }

    const movedFolders: string[] = [];
    for (const folderId of input.folderIds) {
      const folder = folders.find((candidate) => candidate.id === folderId);
      if (!folder) throw notFound();

      const check = checkFolderMove(folders, folderId, input.targetFolderId);
      if (!check.ok) {
        if (check.reason === "same-place") continue;
        if (check.reason === "name-taken") throw nameTaken(folder.name);
        throw new AssetError(moveRefusal[check.reason], 400, "FOLDER_MOVE_REFUSED");
      }

      folder.parentId = input.targetFolderId;
      movedFolders.push(folderId);
    }

    if (movedFolders.length > 0) {
      await tx
        .update(assetFolders)
        .set({ parentId: input.targetFolderId, updatedAt: new Date() })
        .where(inArray(assetFolders.id, movedFolders));
    }

    const movedAssets =
      input.assetIds.length === 0
        ? []
        : await tx
            .update(assets)
            .set({ folderId: input.targetFolderId, updatedAt: new Date() })
            .where(
              and(
                inArray(assets.id, input.assetIds),
                eq(assets.ownerId, input.userId),
                eq(assets.status, "ready"),
                isNull(assets.deletedAt),
                input.targetFolderId === null
                  ? sql`${assets.folderId} is not null`
                  : sql`${assets.folderId} is distinct from ${input.targetFolderId}`,
              ),
            )
            .returning({ id: assets.id });

    return { folders: movedFolders, assets: movedAssets.map((row) => row.id) };
  });
}

/**
 * Bins a folder with everything live inside it, in one step: each live
 * descendant folder and asset becomes `trashed` with this folder as its
 * marker. Things already binned on their own keep their own Bin entries.
 */
export async function trashAssetFolder(input: { userId: string; folderId: string }) {
  if (!isUuid(input.folderId)) throw notFound();

  return mutateTree(input.userId, async (tx) => {
    const subtree = await tx.execute<{ id: string }>(sql`
      with recursive tree(id) as (
        select ${assetFolders.id} from ${assetFolders}
        where ${assetFolders.id} = ${input.folderId}
          and ${assetFolders.ownerId} = ${input.userId}
          and ${assetFolders.status} = 'active'
        union all
        select child.id from asset_folders child
        join tree on child.parent_id = tree.id
        where child.status = 'active'
      )
      select id from tree
    `);
    const ids = [...subtree].map((row) => row.id);
    if (ids.length === 0) throw notFound();

    const now = new Date();
    await tx
      .update(assetFolders)
      .set({
        status: "trashed",
        trashedAt: now,
        trashedViaFolderId: sql`case when ${assetFolders.id} = ${input.folderId} then null else ${input.folderId}::uuid end`,
        updatedAt: now,
      })
      .where(inArray(assetFolders.id, ids));

    const binnedAssets = await tx
      .update(assets)
      .set({ status: "trashed", trashedAt: now, trashedViaFolderId: input.folderId, updatedAt: now })
      .where(
        and(
          inArray(assets.folderId, ids),
          eq(assets.ownerId, input.userId),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      )
      .returning({ id: assets.id });

    return { id: input.folderId, folders: ids.length, assets: binnedAssets.length, trashedAt: now };
  });
}

/**
 * Takes a folder out of the Bin with exactly what was binned along with it.
 * It goes back where it was if that folder is still live, otherwise to the
 * library root, and takes a "(2)" suffix if its name has been reused there.
 */
export async function restoreAssetFolder(input: { userId: string; folderId: string }) {
  if (!isUuid(input.folderId)) throw notFound();

  return mutateTree(input.userId, async (tx) => {
    const [folder] = await tx
      .select({ id: assetFolders.id, parentId: assetFolders.parentId, name: assetFolders.name })
      .from(assetFolders)
      .where(
        and(
          eq(assetFolders.id, input.folderId),
          eq(assetFolders.ownerId, input.userId),
          eq(assetFolders.status, "trashed"),
          isNull(assetFolders.trashedViaFolderId),
        ),
      )
      .limit(1);
    if (!folder) throw notFound();

    const live = await loadLiveFolders(tx, input.userId);
    const parentId =
      folder.parentId && live.some((candidate) => candidate.id === folder.parentId)
        ? folder.parentId
        : null;
    const name = uniqueFolderName(folder.name, siblingNames(live, parentId));
    const now = new Date();

    await tx
      .update(assetFolders)
      .set({ parentId, name, status: "active", trashedAt: null, trashedViaFolderId: null, updatedAt: now })
      .where(eq(assetFolders.id, folder.id));
    await tx
      .update(assetFolders)
      .set({ status: "active", trashedAt: null, trashedViaFolderId: null, updatedAt: now })
      .where(eq(assetFolders.trashedViaFolderId, folder.id));
    const restoredAssets = await tx
      .update(assets)
      .set({ status: "ready", trashedAt: null, trashedViaFolderId: null, updatedAt: now })
      .where(
        and(
          eq(assets.trashedViaFolderId, folder.id),
          eq(assets.ownerId, input.userId),
          eq(assets.status, "trashed"),
        ),
      )
      .returning({ id: assets.id });

    return { id: folder.id, parentId, name, assets: restoredAssets.length };
  });
}

/**
 * Deletes a binned folder for good: the assets binned with it (bytes, quota,
 * renditions), then the folder rows. Things binned on their own inside it keep
 * their Bin entries and move to the root, so nothing disappears unannounced.
 */
export async function deleteAssetFolderForever(input: { userId: string; folderId: string }) {
  if (!isUuid(input.folderId)) throw notFound();

  const [folder] = await db
    .select({ id: assetFolders.id })
    .from(assetFolders)
    .where(
      and(
        eq(assetFolders.id, input.folderId),
        eq(assetFolders.ownerId, input.userId),
        eq(assetFolders.status, "trashed"),
        isNull(assetFolders.trashedViaFolderId),
      ),
    )
    .limit(1);
  if (!folder) throw notFound();

  const deleted = await deleteFolderBinAssetsForever(input.userId, [folder.id]);
  await removeFolderUnits(input.userId, [folder.id]);
  return { id: folder.id, deletedAssets: deleted.length };
}

/**
 * Deletes the rows of binned folder units (each Bin folder plus everything
 * carrying its marker), first moving anything else under them to the root.
 */
async function removeFolderUnits(userId: string, unitIds: string[]) {
  if (unitIds.length === 0) return 0;

  return mutateTree(userId, async (tx) => {
    const inUnit = or(
      inArray(assetFolders.id, unitIds),
      inArray(assetFolders.trashedViaFolderId, unitIds),
    );
    const members = await tx
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(and(inUnit, eq(assetFolders.status, "trashed")));
    const memberIds = members.map((row) => row.id);
    if (memberIds.length === 0) return 0;

    // Folders binned on their own under a unit folder outlive it at the root.
    await tx
      .update(assetFolders)
      .set({ parentId: null })
      .where(
        and(
          inArray(assetFolders.parentId, memberIds),
          sql`${assetFolders.id} not in (${sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
      );
    await tx
      .update(assets)
      .set({ folderId: null })
      .where(inArray(assets.folderId, memberIds));

    const removed = await tx
      .delete(assetFolders)
      .where(inArray(assetFolders.id, memberIds))
      .returning({ id: assetFolders.id });
    return removed.length;
  });
}

/** Empty Bin: every binned asset and folder the user owns, deleted for good. */
export async function emptyMediaBinForUser(userId: string) {
  const deletedAssets = await emptyAssetBinForUser(userId);
  const units = await db
    .select({ id: assetFolders.id })
    .from(assetFolders)
    .where(
      and(
        eq(assetFolders.ownerId, userId),
        eq(assetFolders.status, "trashed"),
        isNull(assetFolders.trashedViaFolderId),
      ),
    );
  const deletedFolders = await removeFolderUnits(userId, units.map((row) => row.id));
  return { deletedAssets, deletedFolders };
}

/**
 * Bin purge for folders. Runs after the asset purge, which already deleted the
 * assets binned with these folders (they share the folder's `trashed_at`).
 */
export async function purgeExpiredBinFolders(cutoff: Date) {
  const expired = await db
    .select({ id: assetFolders.id, ownerId: assetFolders.ownerId })
    .from(assetFolders)
    .where(
      and(
        eq(assetFolders.status, "trashed"),
        isNull(assetFolders.trashedViaFolderId),
        lt(assetFolders.trashedAt, cutoff),
      ),
    );

  const byOwner = new Map<string, string[]>();
  for (const row of expired) byOwner.set(row.ownerId, [...(byOwner.get(row.ownerId) ?? []), row.id]);

  let removed = 0;
  for (const [ownerId, ids] of byOwner) removed += await removeFolderUnits(ownerId, ids);
  return removed;
}

/** Folders in the Bin (not ones binned along with a parent), with what they hold. */
export async function listBinFoldersForUser(userId: string) {
  const rows = await db
    .select({
      id: assetFolders.id,
      name: assetFolders.name,
      trashedAt: assetFolders.trashedAt,
      createdAt: assetFolders.createdAt,
      // Correlated subqueries spell out their tables: Drizzle renders a
      // column reference here unqualified, which would bind to the inner table.
      assetCount: sql<number>`(select count(*)::int from assets a where a.trashed_via_folder_id = "asset_folders"."id" and a.status = 'trashed')`,
      sizeBytes: sql<number>`(select coalesce(sum(a.size_bytes), 0)::bigint from assets a where a.trashed_via_folder_id = "asset_folders"."id" and a.status = 'trashed')`,
      folderCount: sql<number>`(select count(*)::int from asset_folders sub where sub.trashed_via_folder_id = "asset_folders"."id")`,
    })
    .from(assetFolders)
    .where(
      and(
        eq(assetFolders.ownerId, userId),
        eq(assetFolders.status, "trashed"),
        isNull(assetFolders.trashedViaFolderId),
      ),
    )
    .orderBy(sql`${assetFolders.trashedAt} desc`);

  return rows.map((row) => {
    const trashedAt = row.trashedAt ?? row.createdAt;
    return {
      ...row,
      sizeBytes: Number(row.sizeBytes),
      trashedAt,
      purgeAt: binPurgeAt(trashedAt),
    };
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return uuidPattern.test(value);
}
