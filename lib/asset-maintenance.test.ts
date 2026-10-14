import { describe, expect, it } from "vitest";

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
        now,
        graceMs,
      }),
    ).toEqual([]);
  });
});
