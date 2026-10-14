/**
 * Pure parts of the daily asset cleanup (`server/asset-maintenance.ts`), kept
 * here so the rules that decide what gets deleted are unit-tested.
 */

/** Everything Vault writes to the bucket lives under this prefix. */
export const ASSET_KEY_PREFIX = "users/";

export type AssetMaintenanceResult = {
  /** Deleted/failed asset rows removed after the retention period. */
  purgedRows: number;
  /** Bucket objects examined under `ASSET_KEY_PREFIX`. */
  scannedObjects: number;
  /** Objects removed because no live asset references them. */
  deletedObjects: number;
  /** Orphans whose delete failed; retried on the next run. */
  failedDeletes: number;
  durationMs: number;
  trigger: "schedule" | "manual";
  /** Set when the run stopped early (e.g. storage unreachable). */
  error?: string;
};

/**
 * Bucket keys safe to delete: under Vault's prefix, not referenced by any live
 * (`ready` or `pending`) asset, and older than the grace period. The grace
 * period covers any write that lands between listing the bucket and reading
 * the database, and anything a human is mid-way through restoring.
 */
export function selectOrphanKeys(input: {
  objects: { key: string; lastModified: Date | null }[];
  referencedKeys: ReadonlySet<string>;
  now: Date;
  graceMs: number;
}) {
  const cutoff = input.now.getTime() - input.graceMs;

  return input.objects
    .filter(
      (object) =>
        object.key.startsWith(ASSET_KEY_PREFIX) &&
        !input.referencedKeys.has(object.key) &&
        object.lastModified !== null &&
        object.lastModified.getTime() < cutoff,
    )
    .map((object) => object.key);
}
