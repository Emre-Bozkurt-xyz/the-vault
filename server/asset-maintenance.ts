import "server-only";

import { and, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { assets, deploymentSettings } from "@/db/schema";
import {
  ASSET_KEY_PREFIX,
  selectOrphanKeys,
  type AssetMaintenanceResult,
} from "@/lib/asset-maintenance";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { deleteAssetObject, listAssetObjects } from "@/lib/storage/r2";

/**
 * Daily asset cleanup. Deleting an asset frees its R2 object immediately, but
 * two things are left behind: the soft-deleted row, and any object whose
 * delete failed (or that belonged to a deleted account, or a single-request
 * upload that died after writing). This run:
 *
 * 1. hard-deletes `deleted`/`failed` rows past `deletedAssetRetentionDays`
 *    (their tags, links and view counts cascade), and
 * 2. lists the bucket under `users/` and deletes objects that no `ready` or
 *    `pending` asset references and that are older than `orphanGraceMs`.
 *
 * A lease on the `deployment_settings` row keeps it to one process at a time;
 * scheduled runs also skip unless the last run is ~a day old.
 */

const RUN_EVERY_MS = 23 * 60 * 60 * 1000;
const LEASE_MS = 60 * 60 * 1000;
const DELETE_CONCURRENCY = 8;

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
    purgedRows: 0,
    scannedObjects: 0,
    deletedObjects: 0,
    failedDeletes: 0,
    durationMs: 0,
    trigger: input.trigger,
  };

  try {
    result.purgedRows = await purgeExpiredRows(now);

    // List first, then read references: a row is always inserted before its
    // object is written, so nothing listed can be missing from the read.
    const objects = await listAssetObjects(ASSET_KEY_PREFIX);
    result.scannedObjects = objects.length;

    const live = await db
      .select({ storageKey: assets.storageKey })
      .from(assets)
      .where(inArray(assets.status, ["ready", "pending"]));
    const orphans = selectOrphanKeys({
      objects,
      referencedKeys: new Set(live.map((row) => row.storageKey)),
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
