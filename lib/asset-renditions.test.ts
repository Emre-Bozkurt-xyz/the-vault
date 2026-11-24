import { describe, expect, it } from "vitest";

import {
  RENDITIONS,
  RENDITION_VERSION,
  fitRendition,
  hasCurrentRenditions,
  isReferencedRenditionKey,
  isRenditionName,
  needsRenditions,
  parseRenditionKey,
  renditionKey,
  supportsRenditions,
} from "@/lib/asset-renditions";

const owner = "11111111-1111-4111-8111-111111111111";
const asset = "22222222-2222-4222-8222-222222222222";

describe("rendition keys", () => {
  it("round-trips and sits beside the originals, under the swept prefix", () => {
    const key = renditionKey({ ownerId: owner, assetId: asset, version: 3, name: "display" });
    expect(key).toBe(`users/${owner}/renditions/${asset}/v3/display.webp`);
    expect(parseRenditionKey(key)).toEqual({ ownerId: owner, assetId: asset, version: 3, name: "display" });
  });

  it("parses nothing else", () => {
    for (const key of [
      `users/${owner}/assets/${asset}.png`,
      `users/${owner}/renditions/${asset}/v1/original.webp`,
      `users/${owner}/renditions/${asset}/v0/thumb.webp`,
      `users/${owner}/renditions/${asset}/v1/thumb.png`,
      `users/${owner}/renditions/${asset}/v1/thumb.webp/extra`,
      `users/${owner}/renditions/../${asset}/v1/thumb.webp`,
      `users/not-a-uuid/renditions/${asset}/v1/thumb.webp`,
    ]) {
      expect(parseRenditionKey(key)).toBeNull();
    }
  });

  it("only knows the declared rendition names", () => {
    expect(isRenditionName("thumb")).toBe(true);
    expect(isRenditionName("display")).toBe(true);
    expect(isRenditionName("original")).toBe(false);
    expect(isRenditionName("toString")).toBe(false);
    expect(isRenditionName(undefined)).toBe(false);
  });
});

describe("which assets get renditions", () => {
  const image = { kind: "image", mimeType: "image/jpeg" };

  it("covers decodable images only", () => {
    expect(supportsRenditions(image)).toBe(true);
    expect(supportsRenditions({ kind: "image", mimeType: "image/gif" })).toBe(true);
    expect(supportsRenditions({ kind: "pdf", mimeType: "application/pdf" })).toBe(false);
    // A `file` asset is never decoded, whatever its sniffed type says.
    expect(supportsRenditions({ kind: "file", mimeType: "image/png" })).toBe(false);
    expect(supportsRenditions({ kind: "image", mimeType: "image/svg+xml" })).toBe(false);
  });

  it("generates once per version, and does not retry a failure until the version changes", () => {
    expect(needsRenditions({ ...image, renditionStatus: "none", renditionVersion: null })).toBe(true);
    expect(
      needsRenditions({ ...image, renditionStatus: "ready", renditionVersion: RENDITION_VERSION }),
    ).toBe(false);
    expect(
      needsRenditions({ ...image, renditionStatus: "failed", renditionVersion: RENDITION_VERSION }),
    ).toBe(false);
    expect(
      needsRenditions({ ...image, renditionStatus: "ready", renditionVersion: RENDITION_VERSION - 1 }),
    ).toBe(true);
    expect(
      needsRenditions({ ...image, renditionStatus: "failed", renditionVersion: RENDITION_VERSION - 1 }),
    ).toBe(true);
  });

  it("serves only current, ready renditions", () => {
    expect(hasCurrentRenditions({ renditionStatus: "ready", renditionVersion: RENDITION_VERSION })).toBe(true);
    expect(hasCurrentRenditions({ renditionStatus: "ready", renditionVersion: RENDITION_VERSION - 1 })).toBe(
      false,
    );
    expect(hasCurrentRenditions({ renditionStatus: "failed", renditionVersion: RENDITION_VERSION })).toBe(
      false,
    );
  });
});

describe("isReferencedRenditionKey", () => {
  const live = new Map([
    [asset, { ownerId: owner, renditionStatus: "ready" as const, renditionVersion: 2 }],
  ]);

  it("matches owner, asset and exact ready version", () => {
    expect(isReferencedRenditionKey(renditionKey({ ownerId: owner, assetId: asset, version: 2, name: "thumb" }), live)).toBe(true);
    expect(isReferencedRenditionKey(renditionKey({ ownerId: owner, assetId: asset, version: 1, name: "thumb" }), live)).toBe(false);
    expect(isReferencedRenditionKey(`users/${owner}/assets/${asset}.png`, live)).toBe(false);
  });
});

describe("fitRendition", () => {
  it("fits inside the box without enlarging", () => {
    expect(fitRendition({ width: 6000, height: 4000 }, "display")).toEqual({ width: 2048, height: 1365 });
    expect(fitRendition({ width: 6000, height: 4000 }, "thumb")).toEqual({ width: 640, height: 427 });
    expect(fitRendition({ width: 300, height: 200 }, "thumb")).toEqual({ width: 300, height: 200 });
    expect(fitRendition({ width: 600, height: 20000 }, "thumb").height).toBe(RENDITIONS.thumb.maxHeight);
  });
});

describe("scripts/reconcile-assets.mjs", () => {
  it("mirrors the rendition names, or its orphan cleanup would delete thumbnails", async () => {
    const { readFile } = await import("node:fs/promises");
    const { RENDITION_NAMES } = await import("@/lib/asset-renditions");
    const script = await readFile("scripts/reconcile-assets.mjs", "utf8");
    const match = /const RENDITION_NAMES = (\[[^\]]*\]);/.exec(script);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(RENDITION_NAMES);
    expect(script).toContain("/renditions/${asset.id}/v${asset.rendition_version}/${name}.webp");
  });
});
