import { describe, expect, it } from "vitest";

import {
  MAX_BULK_ASSET_IDS,
  REFERENCED_ASSET_STATUSES,
  STORED_ASSET_STATUSES,
  binDaysRemaining,
  binPurgeAt,
  binPurgeCutoff,
  canTransition,
  formatBinCountdown,
  parseBulkAssetAction,
  parseBulkAssetIds,
  readableStatusFor,
  transitionSources,
  transitionTarget,
  type AssetLifecycleStatus,
} from "@/lib/asset-lifecycle";

const allStatuses: AssetLifecycleStatus[] = ["pending", "ready", "trashed", "failed", "deleted"];
const DAY = 24 * 60 * 60 * 1000;

describe("asset lifecycle transitions", () => {
  it("lets owners bin only live assets and restore only binned ones", () => {
    for (const status of allStatuses) {
      expect(canTransition(status, "trash", "owner")).toBe(status === "ready");
      expect(canTransition(status, "restore", "owner")).toBe(status === "trashed");
    }
  });

  it("never lets an owner delete for good without going through the Bin", () => {
    expect(canTransition("ready", "delete", "owner")).toBe(false);
    expect(canTransition("trashed", "delete", "owner")).toBe(true);
    expect(canTransition("pending", "delete", "owner")).toBe(false);
  });

  it("lets admin moderation delete live or binned assets directly", () => {
    expect(transitionSources("delete", "admin")).toEqual(["ready", "trashed"]);
  });

  it("limits the purge job to binned assets and gives it nothing else to do", () => {
    expect(transitionSources("delete", "system")).toEqual(["trashed"]);
    expect(transitionSources("trash", "system")).toEqual([]);
    expect(transitionSources("restore", "system")).toEqual([]);
  });

  it("never re-enters a deleted or failed asset", () => {
    for (const action of ["trash", "restore", "delete"] as const) {
      for (const actor of ["owner", "admin", "system"] as const) {
        expect(canTransition("deleted", action, actor)).toBe(false);
        expect(canTransition("failed", action, actor)).toBe(false);
      }
    }
  });

  it("maps actions to their target status", () => {
    expect(transitionTarget("trash")).toBe("trashed");
    expect(transitionTarget("restore")).toBe("ready");
    expect(transitionTarget("delete")).toBe("deleted");
  });
});

describe("storage accounting", () => {
  it("counts binned assets as stored and keeps their objects from the orphan sweep", () => {
    expect(STORED_ASSET_STATUSES).toContain("trashed");
    expect(REFERENCED_ASSET_STATUSES).toContain("trashed");
    expect(REFERENCED_ASSET_STATUSES).toContain("pending");
    expect(STORED_ASSET_STATUSES).not.toContain("deleted");
    expect(REFERENCED_ASSET_STATUSES).not.toContain("deleted");
  });
});

describe("readableStatusFor", () => {
  it("only lets the owner see a binned asset", () => {
    expect(readableStatusFor("ready", false)).toBe("full");
    expect(readableStatusFor("trashed", true)).toBe("owner-only");
    expect(readableStatusFor("trashed", false)).toBe("none");
    expect(readableStatusFor("deleted", true)).toBe("none");
    expect(readableStatusFor("pending", true)).toBe("none");
  });
});

describe("Bin timing", () => {
  const trashedAt = new Date("2026-11-01T12:00:00Z");

  it("purges 30 days after binning by default", () => {
    expect(binPurgeAt(trashedAt).toISOString()).toBe("2026-12-01T12:00:00.000Z");
    expect(binPurgeAt(trashedAt.toISOString()).getTime()).toBe(binPurgeAt(trashedAt).getTime());
  });

  it("agrees with the cutoff the purge job uses", () => {
    const justDue = new Date(binPurgeAt(trashedAt).getTime() + 1);
    expect(trashedAt < binPurgeCutoff(justDue)).toBe(true);
    const notYet = new Date(binPurgeAt(trashedAt).getTime() - 1);
    expect(trashedAt < binPurgeCutoff(notYet)).toBe(false);
  });

  it("counts remaining days up, and never below zero", () => {
    expect(binDaysRemaining(trashedAt, trashedAt)).toBe(30);
    expect(binDaysRemaining(trashedAt, new Date(trashedAt.getTime() + 29.5 * DAY))).toBe(1);
    expect(binDaysRemaining(trashedAt, new Date(trashedAt.getTime() + 31 * DAY))).toBe(0);
  });

  it("formats the countdown", () => {
    expect(formatBinCountdown(trashedAt, trashedAt)).toBe("Deletes in 30 days");
    expect(formatBinCountdown(trashedAt, new Date(trashedAt.getTime() + 29.2 * DAY))).toBe(
      "Deletes tomorrow",
    );
    expect(formatBinCountdown(trashedAt, new Date(trashedAt.getTime() + 40 * DAY))).toBe(
      "Deletes today",
    );
  });
});

describe("bulk request parsing", () => {
  const id = "0b6f2a5e-2f0c-4a8e-9a43-1d2f3c4b5a69";

  it("accepts and de-duplicates uuids case-insensitively", () => {
    expect(parseBulkAssetIds([id, id.toUpperCase()])).toEqual([id]);
  });

  it("rejects empty, malformed and oversized lists", () => {
    expect(parseBulkAssetIds([])).toBeNull();
    expect(parseBulkAssetIds("nope")).toBeNull();
    expect(parseBulkAssetIds([id, 42])).toBeNull();
    expect(parseBulkAssetIds([id, "'; drop table assets; --"])).toBeNull();
    expect(
      parseBulkAssetIds(
        Array.from({ length: MAX_BULK_ASSET_IDS + 1 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      ),
    ).toBeNull();
  });

  it("accepts only known actions", () => {
    expect(parseBulkAssetAction("trash")).toBe("trash");
    expect(parseBulkAssetAction("restore")).toBe("restore");
    expect(parseBulkAssetAction("delete")).toBe("delete");
    expect(parseBulkAssetAction("purge")).toBeNull();
    expect(parseBulkAssetAction(undefined)).toBeNull();
  });
});
