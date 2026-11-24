/**
 * Thumbnail and display renditions of image assets: what they are, where they
 * live in the bucket, and when one is still wanted. Pure and client-safe, so
 * the rules are unit-tested and the orphan sweep and the generator agree.
 * See docs/26_MEDIA_LIBRARY_AND_FOLDERS_PLAN.md §4.4 and §8.
 *
 *   users/<owner>/assets/<asset>.<ext>                  original
 *   users/<owner>/renditions/<asset>/v<N>/thumb.webp    grid thumbnail
 *   users/<owner>/renditions/<asset>/v<N>/display.webp  viewer / panel size
 *
 * Renditions are derived, metadata-stripped WebP copies. They do not count
 * toward the owner's quota and are regenerated (not migrated) when
 * `RENDITION_VERSION` changes.
 */

/**
 * Bump to regenerate every rendition (new sizes, quality, or format). Old
 * versions stop being referenced as each asset regenerates, and the orphan
 * sweep removes them.
 */
// v2 (2026-11-23): renders also record EXIF "date taken" (`assets.taken_at`).
export const RENDITION_VERSION = 2;

export const RENDITIONS = {
  /** Masonry/grid cards: up to ~320 CSS px wide at 2x. Tall panoramas capped. */
  thumb: { maxWidth: 640, maxHeight: 1920, quality: 72 },
  /** Details panel and the full-screen viewer. */
  display: { maxWidth: 2048, maxHeight: 2048, quality: 80 },
} as const;

export type RenditionName = keyof typeof RENDITIONS;

export const RENDITION_NAMES = Object.keys(RENDITIONS) as RenditionName[];

/** Refuse to decode anything larger (decompression bombs); ~120 megapixels. */
export const RENDITION_MAX_INPUT_PIXELS = 120_000_000;

/** MIME types the generator can decode. */
const RENDERABLE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isRenditionName(value: unknown): value is RenditionName {
  return typeof value === "string" && Object.hasOwn(RENDITIONS, value);
}

export function supportsRenditions(asset: { kind: string; mimeType: string }) {
  return asset.kind === "image" && RENDERABLE_MIME_TYPES.has(asset.mimeType);
}

/** Whether an asset should (re)generate its renditions now. */
export function needsRenditions(asset: {
  kind: string;
  mimeType: string;
  renditionStatus: "none" | "ready" | "failed";
  renditionVersion: number | null;
}) {
  if (!supportsRenditions(asset)) return false;
  // A failure is final for its version: a corrupt file stays corrupt. A new
  // version retries it.
  return asset.renditionStatus === "none" || asset.renditionVersion !== RENDITION_VERSION;
}

/**
 * The rendition version to serve for an asset, or null when it has none.
 * Images render on the server, so they always target the current version
 * (rendered on first request if missing), unless rendering failed for it.
 * Video renditions come from a poster the uploader's browser captured, which
 * the server cannot redo, so a video serves whatever version it stored.
 */
export function servableRenditionVersion(asset: {
  kind: string;
  mimeType: string;
  renditionStatus: "none" | "ready" | "failed";
  renditionVersion: number | null;
}): number | null {
  if (asset.kind === "video") {
    return asset.renditionStatus === "ready" ? asset.renditionVersion : null;
  }
  if (!supportsRenditions(asset)) return null;
  if (asset.renditionStatus === "failed" && asset.renditionVersion === RENDITION_VERSION) return null;
  return RENDITION_VERSION;
}

/** Whether a current rendition exists to serve. */
export function hasCurrentRenditions(asset: {
  renditionStatus: "none" | "ready" | "failed";
  renditionVersion: number | null;
}) {
  return asset.renditionStatus === "ready" && asset.renditionVersion === RENDITION_VERSION;
}

export function renditionKey(input: {
  ownerId: string;
  assetId: string;
  version: number;
  name: RenditionName;
}) {
  return `users/${input.ownerId}/renditions/${input.assetId}/v${input.version}/${input.name}.webp`;
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const renditionKeyPattern = new RegExp(
  `^users/(${uuid})/renditions/(${uuid})/v([1-9][0-9]{0,5})/([a-z]+)\\.webp$`,
);

/** The parts of a rendition key, or null for anything else (originals included). */
export function parseRenditionKey(key: string) {
  const match = renditionKeyPattern.exec(key);
  if (!match || !isRenditionName(match[4])) return null;

  return {
    ownerId: match[1],
    assetId: match[2],
    version: Number(match[3]),
    name: match[4],
  };
}

/** What the orphan sweep needs to know about an asset that may own renditions. */
export type RenditionOwnerRecord = {
  ownerId: string;
  renditionStatus: "none" | "ready" | "failed";
  renditionVersion: number | null;
};

/**
 * A rendition object is kept only while the asset it belongs to still needs its
 * bytes (the caller passes only assets in `REFERENCED_ASSET_STATUSES`), is
 * owned by the user in its path, and records that exact version as ready.
 * Everything else — renditions of purged assets, superseded versions, stray
 * names — is an orphan.
 */
export function isReferencedRenditionKey(
  key: string,
  liveAssets: ReadonlyMap<string, RenditionOwnerRecord>,
) {
  const parsed = parseRenditionKey(key);
  if (!parsed) return false;

  const asset = liveAssets.get(parsed.assetId);
  return (
    asset !== undefined &&
    asset.ownerId === parsed.ownerId &&
    asset.renditionStatus === "ready" &&
    asset.renditionVersion === parsed.version
  );
}

/**
 * Size of a rendition: fits inside the spec's box, keeps the aspect ratio, and
 * never enlarges. Mirrors sharp's `fit: "inside", withoutEnlargement: true`.
 */
export function fitRendition(
  source: { width: number; height: number },
  name: RenditionName,
) {
  const { maxWidth, maxHeight } = RENDITIONS[name];
  const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
