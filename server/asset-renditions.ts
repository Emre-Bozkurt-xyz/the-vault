import "server-only";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db";
import { assets, type AssetKind, type AssetRenditionStatus } from "@/db/schema";
import { REFERENCED_ASSET_STATUSES } from "@/lib/asset-lifecycle";
import {
  RENDITION_NAMES,
  RENDITION_VERSION,
  hasCurrentRenditions,
  needsRenditions,
  renditionKey,
  supportsRenditions,
} from "@/lib/asset-renditions";
import { deleteAssetObject, getAssetObject, putAssetObject } from "@/lib/storage/r2";
import { RenditionDecodeError, renderRenditions } from "@/server/asset-rendition-render";

/**
 * Thumbnail/display renditions for image assets (docs/26 §4.4, §8). Generated
 * right after an upload, lazily on the first request for older images, and in
 * bulk by the daily maintenance run. One process-wide queue keeps at most two
 * decodes in flight and never renders the same asset twice at once.
 */

export type RenditionAsset = {
  id: string;
  ownerId: string;
  storageKey: string;
  kind: AssetKind;
  mimeType: string;
  renditionStatus: AssetRenditionStatus;
  renditionVersion: number | null;
};

const MAX_CONCURRENT = 2;

type QueueState = {
  inflight: Map<string, Promise<boolean>>;
  active: number;
  waiting: (() => void)[];
};

// Route handlers can each get their own copy of a module; the queue must be
// one per process, so it lives on globalThis.
const queueKey = Symbol.for("vault.assetRenditions.queue");
const queue: QueueState = ((globalThis as Record<symbol, unknown>)[queueKey] as QueueState) ??
  ((globalThis as Record<symbol, unknown>)[queueKey] = {
    inflight: new Map(),
    active: 0,
    waiting: [],
  } satisfies QueueState);

async function withSlot<T>(run: () => Promise<T>) {
  if (queue.active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
  }
  queue.active += 1;
  try {
    return await run();
  } finally {
    queue.active -= 1;
    queue.waiting.shift()?.();
  }
}

/**
 * Resolves true when current renditions exist (generating them if needed),
 * false when the asset has none and will not (not an image, or decoding failed
 * for this version). Storage errors reject, so a transient R2 failure is
 * retried later instead of being recorded as a broken image.
 *
 * `bytes`: the original, when the caller already holds it (a fresh upload).
 */
export function ensureRenditions(asset: RenditionAsset, bytes?: Buffer): Promise<boolean> {
  if (!supportsRenditions(asset)) return Promise.resolve(false);
  if (hasCurrentRenditions(asset)) return Promise.resolve(true);
  if (!needsRenditions(asset)) return Promise.resolve(false);

  const existing = queue.inflight.get(asset.id);
  if (existing) return existing;

  const job = withSlot(() => generate(asset, bytes)).finally(() => {
    queue.inflight.delete(asset.id);
  });
  queue.inflight.set(asset.id, job);
  return job;
}

async function generate(asset: RenditionAsset, bytes?: Buffer) {
  const source = bytes ?? (await readObject(asset.storageKey));
  // The original is gone from storage (a manual cleanup, or a restore into
  // another bucket): nothing to render, but nothing permanent to record
  // either, so a later restore of the object still gets thumbnails.
  if (!source) return false;

  let rendered;
  try {
    rendered = await renderRenditions(source, asset.mimeType);
  } catch (error) {
    if (!(error instanceof RenditionDecodeError)) throw error;
    console.warn("[asset-renditions] could not render", { assetId: asset.id, error: error.message });
    await db
      .update(assets)
      .set({ renditionStatus: "failed", renditionVersion: RENDITION_VERSION })
      .where(eq(assets.id, asset.id));
    return false;
  }

  const keys = RENDITION_NAMES.map((name) => ({
    name,
    key: renditionKey({
      ownerId: asset.ownerId,
      assetId: asset.id,
      version: RENDITION_VERSION,
      name,
    }),
  }));

  // Objects first, row second: until the row says `ready` at this version the
  // orphan sweep's grace period is what protects them.
  for (const { name, key } of keys) {
    await putAssetObject({
      key,
      body: rendered.outputs[name].body,
      contentType: "image/webp",
    });
  }

  const [updated] = await db
    .update(assets)
    .set({
      renditionStatus: "ready",
      renditionVersion: RENDITION_VERSION,
      width: rendered.width,
      height: rendered.height,
      takenAt: rendered.takenAt ? new Date(rendered.takenAt) : null,
    })
    .where(
      and(
        eq(assets.id, asset.id),
        inArray(assets.status, [...REFERENCED_ASSET_STATUSES]),
        isNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id });

  if (!updated) {
    // Deleted for good while we rendered: nothing will ever reference these.
    await Promise.allSettled(keys.map(({ key }) => deleteAssetObject(key)));
    return false;
  }

  // A superseded version is no longer referenced; remove it now rather than
  // leaving it for the sweep.
  if (
    asset.renditionStatus === "ready" &&
    asset.renditionVersion !== null &&
    asset.renditionVersion !== RENDITION_VERSION
  ) {
    await deleteRenditionObjects({
      ownerId: asset.ownerId,
      assetId: asset.id,
      version: asset.renditionVersion,
    });
  }

  return true;
}

/** A video's poster frame, captured by the uploader's browser. */
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;
/** Longest believable duration (a day), so a bad client value can't skew sorts. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_DIMENSION = 16_384;

/**
 * Stores renditions for a video from its poster frame: the image goes through
 * the same pipeline as photos (re-encoded WebP, metadata stripped, pixel
 * limit), and the browser's measurements are clamped before they are kept.
 * Resolves false when the poster can't be decoded or the video is gone.
 */
export async function storeVideoPoster(input: {
  asset: Pick<RenditionAsset, "id" | "ownerId" | "renditionStatus" | "renditionVersion">;
  bytes: Buffer;
  mimeType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}) {
  let rendered;
  try {
    rendered = await renderRenditions(input.bytes, input.mimeType);
  } catch (error) {
    if (error instanceof RenditionDecodeError) return false;
    throw error;
  }

  const keys = RENDITION_NAMES.map((name) => ({
    name,
    key: renditionKey({
      ownerId: input.asset.ownerId,
      assetId: input.asset.id,
      version: RENDITION_VERSION,
      name,
    }),
  }));
  for (const { name, key } of keys) {
    await putAssetObject({ key, body: rendered.outputs[name].body, contentType: "image/webp" });
  }

  const clamp = (value: number | null, max: number) =>
    value !== null && Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : null;

  const [updated] = await db
    .update(assets)
    .set({
      renditionStatus: "ready",
      renditionVersion: RENDITION_VERSION,
      width: clamp(input.width, MAX_DIMENSION) ?? rendered.width,
      height: clamp(input.height, MAX_DIMENSION) ?? rendered.height,
      durationMs: clamp(input.durationMs, MAX_DURATION_MS),
    })
    .where(
      and(
        eq(assets.id, input.asset.id),
        eq(assets.kind, "video"),
        inArray(assets.status, [...REFERENCED_ASSET_STATUSES]),
        isNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id });

  if (!updated) {
    await Promise.allSettled(keys.map(({ key }) => deleteAssetObject(key)));
    return false;
  }

  if (
    input.asset.renditionStatus === "ready" &&
    input.asset.renditionVersion !== null &&
    input.asset.renditionVersion !== RENDITION_VERSION
  ) {
    await deleteRenditionObjects({
      ownerId: input.asset.ownerId,
      assetId: input.asset.id,
      version: input.asset.renditionVersion,
    });
  }
  return true;
}

async function readObject(key: string) {
  const object = await getAssetObject(key).catch((error: unknown) => {
    if (error instanceof Error && error.name === "NoSuchKey") return null;
    throw error;
  });
  if (!object) return null;
  const body = object.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new Error("Asset object has no readable body.");
  }
  return Buffer.from(await body.transformToByteArray());
}

/** Best-effort removal of one version's rendition objects (the sweep retries). */
export async function deleteRenditionObjects(input: {
  ownerId: string;
  assetId: string;
  version: number;
}) {
  const settled = await Promise.allSettled(
    RENDITION_NAMES.map((name) => deleteAssetObject(renditionKey({ ...input, name }))),
  );
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.error("[asset-renditions] failed to delete rendition", {
        assetId: input.assetId,
        error: outcome.reason,
      });
    }
  }
}

async function loadRenditionAsset(assetId: string) {
  const [asset] = await db
    .select({
      id: assets.id,
      ownerId: assets.ownerId,
      storageKey: assets.storageKey,
      kind: assets.kind,
      mimeType: assets.mimeType,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.status, "ready")))
    .limit(1);
  return asset ?? null;
}

/**
 * Renders a fresh upload's renditions after the response has been sent, so the
 * upload returns at once and the thumbnail is usually ready by the time the
 * library asks for it. Falls back to a detached promise outside a request.
 */
export function scheduleRenditionsAfterUpload(assetId: string, bytes?: Buffer) {
  const run = async () => {
    try {
      const asset = await loadRenditionAsset(assetId);
      if (asset) await ensureRenditions(asset, bytes);
    } catch (error) {
      // The lazy path and the daily backfill will try again.
      console.error("[asset-renditions] post-upload render failed", { assetId, error });
    }
  };

  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Daily backfill: renders up to `limit` images that have no current renditions
 * (older uploads, or everything after a `RENDITION_VERSION` bump), newest
 * first, stopping at `deadline`. Returns how many were rendered.
 */
export async function backfillRenditions(input: { limit: number; deadline: number }) {
  const candidates = await db
    .select({
      id: assets.id,
      ownerId: assets.ownerId,
      storageKey: assets.storageKey,
      kind: assets.kind,
      mimeType: assets.mimeType,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(
      and(
        eq(assets.kind, "image"),
        inArray(assets.status, ["ready", "trashed"]),
        isNull(assets.deletedAt),
        or(
          eq(assets.renditionStatus, "none"),
          sql`${assets.renditionVersion} is distinct from ${RENDITION_VERSION}`,
        ),
      ),
    )
    .orderBy(sql`${assets.createdAt} desc`)
    .limit(input.limit);

  let rendered = 0;
  for (const asset of candidates) {
    if (Date.now() > input.deadline) break;
    try {
      if (await ensureRenditions(asset)) rendered += 1;
    } catch (error) {
      console.error("[asset-renditions] backfill failed", { assetId: asset.id, error });
    }
  }
  return rendered;
}
