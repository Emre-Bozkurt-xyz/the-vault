/**
 * The asset lifecycle and Bin rules, kept pure so they are unit-tested and so
 * server code asks one place which statuses mean what instead of hard-coding
 * lists. See docs/26_MEDIA_LIBRARY_AND_FOLDERS_PLAN.md §4.1.
 *
 *   pending ──► ready ◄──► trashed ──► deleted ──► (row purged later)
 *      └──► failed ──► (row purged later)
 *
 * Client code imports this too (Bin countdowns), so keep it dependency-free
 * apart from the limits config.
 */
import { ASSET_LIMITS } from "@/lib/config/asset-limits";

export type AssetLifecycleStatus = "pending" | "ready" | "trashed" | "failed" | "deleted";

/** Who is asking for a transition. Only moderation may skip the Bin. */
export type AssetLifecycleActor = "owner" | "admin" | "system";

export type AssetLifecycleAction = "trash" | "restore" | "delete";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Statuses whose bytes exist in storage and count against the owner's quota
 * (`pending` counts too, but only while its upload row exists — that check is
 * a join, so it stays in the quota query itself).
 */
export const STORED_ASSET_STATUSES = ["ready", "trashed"] as const;

/**
 * Statuses whose storage object must survive the orphan sweep. `pending`
 * covers uploads in flight; `trashed` covers the Bin.
 */
export const REFERENCED_ASSET_STATUSES = ["ready", "pending", "trashed"] as const;

/**
 * The statuses an action may start from, per actor. Every server transition is
 * a conditional `UPDATE … WHERE status IN (from)`, so an id in any other state
 * is simply not affected — double clicks and races are no-ops, not errors.
 *
 * - Owners move `ready` to the Bin, restore from it, and delete for good only
 *   from it: "Delete forever" never skips the Bin.
 * - Admin moderation deletes live or binned assets directly.
 * - The system (Bin purge) deletes only binned assets.
 */
export function transitionSources(
  action: AssetLifecycleAction,
  actor: AssetLifecycleActor,
): readonly AssetLifecycleStatus[] {
  switch (action) {
    case "trash":
      return actor === "system" ? [] : ["ready"];
    case "restore":
      return actor === "system" ? [] : ["trashed"];
    case "delete":
      return actor === "admin" ? ["ready", "trashed"] : ["trashed"];
  }
}

export function transitionTarget(action: AssetLifecycleAction): AssetLifecycleStatus {
  return action === "trash" ? "trashed" : action === "restore" ? "ready" : "deleted";
}

export function canTransition(
  from: AssetLifecycleStatus,
  action: AssetLifecycleAction,
  actor: AssetLifecycleActor,
) {
  return transitionSources(action, actor).includes(from);
}

/**
 * Who may read an asset's bytes in a given status: anyone (subject to the
 * usual visibility/document checks) when `ready`; only its owner when
 * `trashed`, so the Bin can show previews; nobody otherwise.
 */
export function readableStatusFor(
  status: AssetLifecycleStatus,
  isOwner: boolean,
): "full" | "owner-only" | "none" {
  if (status === "ready") return "full";
  if (status === "trashed" && isOwner) return "owner-only";
  return "none";
}

/** When a binned asset is deleted for good. */
export function binPurgeAt(
  trashedAt: Date | string,
  retentionDays: number = ASSET_LIMITS.binRetentionDays,
) {
  const start = trashedAt instanceof Date ? trashedAt : new Date(trashedAt);
  return new Date(start.getTime() + retentionDays * DAY_MS);
}

/** Assets binned before this instant are due for purge at `now`. */
export function binPurgeCutoff(
  now: Date,
  retentionDays: number = ASSET_LIMITS.binRetentionDays,
) {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Whole days left before purge, rounded up so "less than a day" reads as 1
 * until it is actually due, and never negative (purge runs about daily, so an
 * overdue item can sit a few hours past its date).
 */
export function binDaysRemaining(
  trashedAt: Date | string,
  now: Date = new Date(),
  retentionDays: number = ASSET_LIMITS.binRetentionDays,
) {
  const remaining = binPurgeAt(trashedAt, retentionDays).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

/** "Deletes in 12 days", "Deletes tomorrow", "Deletes today". */
export function formatBinCountdown(
  trashedAt: Date | string,
  now: Date = new Date(),
  retentionDays: number = ASSET_LIMITS.binRetentionDays,
) {
  const days = binDaysRemaining(trashedAt, now, retentionDays);
  if (days <= 0) return "Deletes today";
  if (days === 1) return "Deletes tomorrow";
  return `Deletes in ${days} days`;
}

/** Most ids one bulk request may name. */
export const MAX_BULK_ASSET_IDS = 500;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates and de-duplicates the ids of a bulk request. Returns null for
 * anything malformed (not an array, a non-uuid, too many) so the route can
 * answer 400 without touching the database.
 */
export function parseBulkAssetIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_BULK_ASSET_IDS) return null;

  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !uuidPattern.test(item)) return null;
    ids.add(item.toLowerCase());
  }

  return [...ids];
}

export function parseBulkAssetAction(value: unknown): AssetLifecycleAction | null {
  return value === "trash" || value === "restore" || value === "delete" ? value : null;
}
