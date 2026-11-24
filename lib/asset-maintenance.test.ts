import { describe, expect, it } from "vitest";

import { renditionKey, RENDITION_VERSION } from "./asset-renditions";
import { selectOrphanKeys } from "./asset-maintenance";

const now = new Date("2026-10-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

describe("selectOrphanKeys", () => {
  const graceMs = 6 * 60 * 60 * 1000;

  it("deletes old, unreferenced objects under the asset prefix", () => {
    expect(
      selectOrphanKeys({
        objects: [{ key: "users/u1/assets/a.png", lastModified: hoursAgo(48) }],
        referencedKeys: new Set(),
        liveRenditions: new Map(),
        now,
        graceMs,
      }),
    ).toEqual(["users/u1/assets/a.png"]);
  });

  it("keeps objects a live asset references", () => {
    expect(
      selectOrphanKeys({
        objects: [{ key: "users/u1/assets/a.png", lastModified: hoursAgo(48) }],
        referencedKeys: new Set(["users/u1/assets/a.png"]),
        liveRenditions: new Map(),
        now,
        graceMs,
      }),
    ).toEqual([]);
  });

  it("keeps objects inside the grace period, or with no timestamp", () => {
    expect(
      selectOrphanKeys({
        objects: [
          { key: "users/u1/assets/new.png", lastModified: hoursAgo(1) },
          { key: "users/u1/assets/unknown.png", lastModified: null },
        ],
        referencedKeys: new Set(),
        liveRenditions: new Map(),
        now,
        graceMs,
      }),
    ).toEqual([]);
  });

  it("never touches keys outside the asset prefix", () => {
    expect(
      selectOrphanKeys({
        objects: [
          { key: "backups/2026-10-01.tar.gz", lastModified: hoursAgo(500) },
          { key: "t/seeded.png", lastModified: hoursAgo(500) },
        ],
        referencedKeys: new Set(),
        liveRenditions: new Map(),
        now,
        graceMs,
      }),
    ).toEqual([]);
  });

  describe("renditions", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const asset = "22222222-2222-4222-8222-222222222222";
    const other = "33333333-3333-4333-8333-333333333333";
    const key = (version: number, name: "thumb" | "display" = "thumb", ownerId = owner) =>
      renditionKey({ ownerId, assetId: asset, version, name });
    const old = (k: string) => ({ key: k, lastModified: hoursAgo(48) });
    const ready = new Map([
      [asset, { ownerId: owner, renditionStatus: "ready" as const, renditionVersion: RENDITION_VERSION }],
    ]);

    it("keeps the current renditions of a live asset", () => {
      expect(
        selectOrphanKeys({
          objects: [old(key(RENDITION_VERSION)), old(key(RENDITION_VERSION, "display"))],
          referencedKeys: new Set(),
          liveRenditions: ready,
          now,
          graceMs,
        }),
      ).toEqual([]);
    });

    it("deletes renditions of purged assets, superseded versions, and forged owners", () => {
      const stale = old(key(RENDITION_VERSION + 1));
      const forged = old(key(RENDITION_VERSION, "thumb", other));
      const purged = old(renditionKey({ ownerId: owner, assetId: other, version: 1, name: "thumb" }));
      expect(
        selectOrphanKeys({
          objects: [stale, forged, purged],
          referencedKeys: new Set(),
          liveRenditions: ready,
          now,
          graceMs,
        }),
      ).toEqual([stale.key, forged.key, purged.key]);
    });

    it("deletes renditions of an asset whose generation failed or never ran", () => {
      for (const renditionStatus of ["failed", "none"] as const) {
        expect(
          selectOrphanKeys({
            objects: [old(key(RENDITION_VERSION))],
            referencedKeys: new Set(),
            liveRenditions: new Map([
              [asset, { ownerId: owner, renditionStatus, renditionVersion: RENDITION_VERSION }],
            ]),
            now,
            graceMs,
          }),
        ).toHaveLength(1);
      }
    });

    it("leaves a rendition written moments ago alone even before its row says ready", () => {
      expect(
        selectOrphanKeys({
          objects: [{ key: key(RENDITION_VERSION), lastModified: hoursAgo(1) }],
          referencedKeys: new Set(),
          liveRenditions: new Map(),
          now,
          graceMs,
        }),
      ).toEqual([]);
    });
  });
});
