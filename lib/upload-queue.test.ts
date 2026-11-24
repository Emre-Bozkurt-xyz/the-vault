import { describe, expect, it } from "vitest";

import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { isLargeUpload, nextUploadIndex } from "@/lib/upload-queue";

const SMALL = { sizeBytes: 3 * 1024 * 1024 };
const LARGE = { sizeBytes: ASSET_LIMITS.directUploadThresholdBytes + 1 };

describe("upload queue scheduling", () => {
  it("splits small and large at the direct-upload threshold", () => {
    expect(isLargeUpload(ASSET_LIMITS.directUploadThresholdBytes)).toBe(false);
    expect(isLargeUpload(ASSET_LIMITS.directUploadThresholdBytes + 1)).toBe(true);
  });

  it("starts in queue order until every slot is busy", () => {
    expect(nextUploadIndex([SMALL, SMALL], { running: 0, runningLarge: 0 })).toBe(0);
    expect(nextUploadIndex([SMALL], { running: 2, runningLarge: 0 })).toBe(0);
    expect(nextUploadIndex([SMALL], { running: 3, runningLarge: 0 })).toBe(-1);
    expect(nextUploadIndex([], { running: 0, runningLarge: 0 })).toBe(-1);
  });

  it("runs one large file at a time and lets small files past a waiting one", () => {
    expect(nextUploadIndex([LARGE, SMALL], { running: 0, runningLarge: 0 })).toBe(0);
    expect(nextUploadIndex([LARGE, SMALL], { running: 1, runningLarge: 1 })).toBe(1);
    expect(nextUploadIndex([LARGE, LARGE], { running: 1, runningLarge: 1 })).toBe(-1);
  });

  it("honours a one-at-a-time limit", () => {
    const serial = { total: 1, large: 1 };
    expect(nextUploadIndex([SMALL, SMALL], { running: 0, runningLarge: 0 }, serial)).toBe(0);
    expect(nextUploadIndex([SMALL, SMALL], { running: 1, runningLarge: 0 }, serial)).toBe(-1);
  });
});
