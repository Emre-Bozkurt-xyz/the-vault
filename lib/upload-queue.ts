import { ASSET_LIMITS } from "@/lib/config/asset-limits";

/**
 * Scheduling for the browser upload queue (`useAssetUploads`). Small files
 * each make one round trip through Vault, so a batch of photos is bound by
 * latency, not bandwidth: running a few at once is what makes it fast. A
 * large file already sends several parts in parallel straight to storage,
 * so only one runs at a time and small files fill the other slots.
 */

/** Files uploading at once, by default. */
export const UPLOAD_CONCURRENCY = 3;
/** Large (direct, multipart) uploads at once; each already runs parts in parallel. */
export const LARGE_UPLOAD_CONCURRENCY = 1;

/** Whether a file takes the direct-to-storage multipart path. */
export function isLargeUpload(sizeBytes: number) {
  return sizeBytes > ASSET_LIMITS.directUploadThresholdBytes;
}

export type UploadSlots = { running: number; runningLarge: number };
export type UploadLimits = { total: number; large: number };

/**
 * Which queued upload to start next, or -1 when none may start now. Takes the
 * first in queue order that fits: a large file waiting for the large slot
 * doesn't hold up the small files behind it.
 */
export function nextUploadIndex(
  queue: readonly { sizeBytes: number }[],
  slots: UploadSlots,
  limits: UploadLimits = { total: UPLOAD_CONCURRENCY, large: LARGE_UPLOAD_CONCURRENCY },
): number {
  if (slots.running >= Math.max(1, limits.total)) return -1;
  const largeFree = slots.runningLarge < Math.max(1, limits.large);
  return queue.findIndex((item) => largeFree || !isLargeUpload(item.sizeBytes));
}
