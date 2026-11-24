import "server-only";

import { and, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { assets, deploymentSettings } from "@/db/schema";
import { REFERENCED_ASSET_STATUSES, binPurgeCutoff } from "@/lib/asset-lifecycle";
import {
  ASSET_KEY_PREFIX,
  selectOrphanKeys,
  type AssetMaintenanceResult,
} from "@/lib/asset-maintenance";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { deleteAssetObject, listAssetObjects } from "@/lib/storage/r2";
import { purgeExpiredBinFolders } from "@/server/asset-folders";
import { purgeExpiredBinAssets } from "@/server/assets";
import { backfillRenditions } from "@/server/asset-renditions";

/**
 * Daily asset cleanup. This run:
 *
 * 1. empties the Bin of anything binned more than `binRetentionDays` ago —
 *    deleted for good: bytes removed, quota released (`purgeExpiredBinAssets`);
 * 2. hard-deletes `deleted`/`failed` rows past `deletedAssetRetentionDays`
 *    (their tags, links and view counts cascade); and
 * 3. lists the bucket under `users/` and deletes objects that no `ready`,
 *    `pending` or `trashed` asset references and that are older than
 *    `orphanGraceMs` — failed deletes, deleted accounts' files, single-request
 *    uploads that died after writing, and renditions of purged assets or of a
 *    superseded `RENDITION_VERSION`; then
 * 4. renders thumbnails for images that have none yet (older uploads, or all
 *    of them after a version bump), a bounded batch per run.
 *
 * A lease on the `deployment_settings` row keeps it to one process at a time;
 * scheduled runs also skip unless the last run is ~a day old.
 */

const RUN_EVERY_MS = 23 * 60 * 60 * 1000;
const LEASE_MS = 60 * 60 * 1000;
const DELETE_CONCURRENCY = 8;
/** Bin purge batch size, and how many batches one run may take. */
const BIN_PURGE_BATCH = 200;
const BIN_PURGE_MAX_BATCHES = 50;
/** Rendition backfill: images per run, and the most time it may take. */
const RENDITION_BACKFILL_LIMIT = 300;
const RENDITION_BACKFILL_MS = 10 * 60 * 1000;

export async function runAssetMaintenance(input: {
  trigger: AssetMaintenanceResult["trigger"];
  now?: Date;
}): Promise<AssetMaintenanceResult | null> {
  const now = input.now ?? new Date();

  if (!(await claimLease(now, input.trigger === "manual"))) {
    return null;
  }

  const startedAt = Date.now();
  const result: AssetMaintenanceResult = {
    binPurged: 0,
    renditionsGenerated: 0,
    purgedRows: 0,
    scannedObjects: 0,
    deletedObjects: 0,
    failedDeletes: 0,
    durationMs: 0,
    trigger: input.trigger,
  };

  try {
    result.binPurged = await purgeExpiredBin(now);
    result.purgedRows = await purgeExpiredRows(now);

    // List first, then read references: an asset row is always inserted
    // before its object is written, so no listed original can be missing from
    // the read. Renditions are written before their row says `ready`; the
    // grace period is what covers one listed mid-render.
    const objects = await listAssetObjects(ASSET_KEY_PREFIX);
    result.scannedObjects = objects.length;

    const live = await db
      .select({
        id: assets.id,
        ownerId: assets.ownerId,
        storageKey: assets.storageKey,
        renditionStatus: assets.renditionStatus,
        renditionVersion: assets.renditionVersion,
      })
      .from(assets)
      .where(inArray(assets.status, [...REFERENCED_ASSET_STATUSES]));
    const orphans = selectOrphanKeys({
      objects,
      referencedKeys: new Set(live.map((row) => row.storageKey)),
      liveRenditions: new Map(live.map((row) => [row.id, row])),
      now,
      graceMs: ASSET_LIMITS.orphanGraceMs,
    });

    for (let index = 0; index < orphans.length; index += DELETE_CONCURRENCY) {
      const batch = orphans.slice(index, index + DELETE_CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((key) => deleteAssetObject(key)));

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") result.deletedObjects += 1;
        else result.failedDeletes += 1;
      }
    }

    result.renditionsGenerated = await backfillRenditions({
      limit: RENDITION_BACKFILL_LIMIT,
      deadline: Date.now() + RENDITION_BACKFILL_MS,
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Asset maintenance failed.";
    console.error("[asset-maintenance] run failed", error);
  }

  result.durationMs = Date.now() - startedAt;

  await db
    .update(deploymentSettings)
    .set({
      assetMaintenanceStartedAt: null,
      assetMaintenanceRanAt: now,
      assetMaintenanceResult: result,
    })
    .where(sql`${deploymentSettings.id}`);

  return result;
}

export async function getAssetMaintenanceStatus() {
  const [row] = await db
    .select({
      ranAt: deploymentSettings.assetMaintenanceRanAt,
      startedAt: deploymentSettings.assetMaintenanceStartedAt,
      result: deploymentSettings.assetMaintenanceResult,
    })
    .from(deploymentSettings)
    .limit(1);

  return row ?? { ranAt: null, startedAt: null, result: null };
}

/**
 * Takes the run lease unless another run holds a fresh one. Scheduled runs
 * additionally require the last run to be ~a day old; manual runs do not.
 */
async function claimLease(now: Date, force: boolean) {
  await db.insert(deploymentSettings).values({ id: true }).onConflictDoNothing();

  const leaseFree = or(
    isNull(deploymentSettings.assetMaintenanceStartedAt),
    lt(deploymentSettings.assetMaintenanceStartedAt, new Date(now.getTime() - LEASE_MS)),
  );
  const due = force
    ? undefined
    : or(
        isNull(deploymentSettings.assetMaintenanceRanAt),
        lt(deploymentSettings.assetMaintenanceRanAt, new Date(now.getTime() - RUN_EVERY_MS)),
      );

  const claimed = await db
    .update(deploymentSettings)
    .set({ assetMaintenanceStartedAt: now })
    .where(and(sql`${deploymentSettings.id}`, leaseFree, due))
    .returning({ id: deploymentSettings.id });

  return claimed.length > 0;
}

/**
 * Deletes for good whatever sat in the Bin past its retention. Bounded per run
 * so one huge Bin cannot hold the lease for hours; the rest goes tomorrow.
 */
async function purgeExpiredBin(now: Date) {
  const cutoff = binPurgeCutoff(now);
  let total = 0;

  for (let batch = 0; batch < BIN_PURGE_MAX_BATCHES; batch += 1) {
    const purged = await purgeExpiredBinAssets({ cutoff, limit: BIN_PURGE_BATCH });
    total += purged.length;
    if (purged.length < BIN_PURGE_BATCH) break;
  }

  // Folder rows go after their assets (binned together, same `trashed_at`).
  await purgeExpiredBinFolders(cutoff);

  return total;
}

async function purgeExpiredRows(now: Date) {
  const cutoff = new Date(
    now.getTime() - ASSET_LIMITS.deletedAssetRetentionDays * 24 * 60 * 60 * 1000,
  );

  // Failed uploads carry no `deleted_at`; they ended at `updated_at`.
  const purged = await db
    .delete(assets)
    .where(
      and(
        inArray(assets.status, ["deleted", "failed"]),
        // Raw fragments bypass Drizzle's column mapping, so the driver gets
        // the bound value as-is: send text and cast, never a Date.
        sql`coalesce(${assets.deletedAt}, ${assets.updatedAt}) < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: assets.id });

  return purged.length;
}
