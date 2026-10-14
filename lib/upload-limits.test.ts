import { describe, expect, it } from "vitest";

import { ASSET_LIMITS } from "@/lib/config/asset-limits";

import { resolveUploadLimits, uploadLimitMiBSchema } from "./upload-limits";

const MiB = 1024 * 1024;

describe("resolveUploadLimits", () => {
  it("uses repo defaults when nothing is set", () => {
    expect(resolveUploadLimits(null)).toEqual({
      imageMaxBytes: ASSET_LIMITS.imageMaxBytes,
      pdfMaxBytes: ASSET_LIMITS.pdfMaxBytes,
      fileMaxBytes: ASSET_LIMITS.fileMaxBytes,
    });
  });

  it("prefers admin values and falls back per field", () => {
    expect(
      resolveUploadLimits({
        imageMaxUploadBytes: 3 * MiB,
        pdfMaxUploadBytes: null,
        fileMaxUploadBytes: 80 * MiB,
      }),
    ).toEqual({
      imageMaxBytes: 3 * MiB,
      pdfMaxBytes: ASSET_LIMITS.pdfMaxBytes,
      fileMaxBytes: 80 * MiB,
    });
  });

  it("clamps to the ceiling and ignores non-positive values", () => {
    const limits = resolveUploadLimits({
      imageMaxUploadBytes: 0,
      pdfMaxUploadBytes: -5,
      fileMaxUploadBytes: ASSET_LIMITS.uploadCeilingBytes * 4,
    });

    expect(limits.imageMaxBytes).toBe(ASSET_LIMITS.imageMaxBytes);
    expect(limits.pdfMaxBytes).toBe(ASSET_LIMITS.pdfMaxBytes);
    expect(limits.fileMaxBytes).toBe(ASSET_LIMITS.uploadCeilingBytes);
  });
});

describe("uploadLimitMiBSchema", () => {
  it("treats blank as reset to default", () => {
    expect(uploadLimitMiBSchema.parse("")).toBeNull();
    expect(uploadLimitMiBSchema.parse("   ")).toBeNull();
  });

  it("converts MiB to whole bytes", () => {
    expect(uploadLimitMiBSchema.parse("20")).toBe(20 * MiB);
    expect(uploadLimitMiBSchema.parse("1.5")).toBe(1.5 * MiB);
  });

  it("rejects zero, negatives, junk, and values over the ceiling", () => {
    const ceilingMiB = ASSET_LIMITS.uploadCeilingBytes / MiB;

    for (const value of ["0", "-1", "abc", String(ceilingMiB + 1)]) {
      expect(uploadLimitMiBSchema.safeParse(value).success).toBe(false);
    }
    expect(uploadLimitMiBSchema.parse(String(ceilingMiB))).toBe(
      ASSET_LIMITS.uploadCeilingBytes,
    );
  });
});
