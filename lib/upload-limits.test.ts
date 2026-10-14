import { describe, expect, it } from "vitest";

import { ASSET_LIMITS } from "@/lib/config/asset-limits";

import {
  MAX_MULTIPART_PARTS,
  multipartPartRange,
  partsCoverFile,
  planMultipartUpload,
  resolveUploadLimits,
  uploadLimitMiBSchema,
} from "./upload-limits";

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
      fileMaxUploadBytes: ASSET_LIMITS.maxUploadBytes * 4,
    });

    expect(limits.imageMaxBytes).toBe(ASSET_LIMITS.imageMaxBytes);
    expect(limits.pdfMaxBytes).toBe(ASSET_LIMITS.pdfMaxBytes);
    expect(limits.fileMaxBytes).toBe(ASSET_LIMITS.maxUploadBytes);
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
    const ceilingMiB = ASSET_LIMITS.maxUploadBytes / MiB;

    for (const value of ["0", "-1", "abc", String(ceilingMiB + 1)]) {
      expect(uploadLimitMiBSchema.safeParse(value).success).toBe(false);
    }
    expect(uploadLimitMiBSchema.parse(String(ceilingMiB))).toBe(
      ASSET_LIMITS.maxUploadBytes,
    );
  });
});

describe("planMultipartUpload", () => {
  it("uses the floor part size for ordinary large files", () => {
    expect(planMultipartUpload(100 * MiB)).toEqual({
      partSizeBytes: ASSET_LIMITS.multipartPartBytes,
      partCount: Math.ceil((100 * MiB) / ASSET_LIMITS.multipartPartBytes),
    });
  });

  it("grows the part size so huge files stay within the part limit", () => {
    const size = 400 * 1024 * MiB; // 400 GiB
    const plan = planMultipartUpload(size);

    expect(plan.partCount).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);
    expect(plan.partSizeBytes % MiB).toBe(0);
    expect(plan.partSizeBytes).toBeGreaterThanOrEqual(5 * MiB);
  });

  it("rejects empty and fractional sizes", () => {
    expect(() => planMultipartUpload(0)).toThrow(RangeError);
    expect(() => planMultipartUpload(1.5)).toThrow(RangeError);
  });
});

describe("multipartPartRange", () => {
  it("covers the file exactly with a short last part", () => {
    const size = 40 * MiB + 7;
    const { partSizeBytes, partCount } = planMultipartUpload(size);
    let covered = 0;

    for (let part = 1; part <= partCount; part += 1) {
      const { start, end } = multipartPartRange(part, partSizeBytes, size);
      expect(start).toBe(covered);
      covered = end;
    }

    expect(covered).toBe(size);
    const last = multipartPartRange(partCount, partSizeBytes, size);
    expect(last.end - last.start).toBe(size - (partCount - 1) * partSizeBytes);
  });
});

describe("partsCoverFile", () => {
  const sizeBytes = 40 * MiB + 7;
  const plan = planMultipartUpload(sizeBytes);
  const upload = { ...plan, sizeBytes };
  const goodParts = Array.from({ length: plan.partCount }, (_, index) => {
    const { start, end } = multipartPartRange(index + 1, plan.partSizeBytes, sizeBytes);
    return { partNumber: index + 1, sizeBytes: end - start };
  });

  it("accepts the exact planned layout", () => {
    expect(partsCoverFile(goodParts, upload)).toBe(true);
  });

  it("rejects a missing part", () => {
    expect(partsCoverFile(goodParts.slice(1), upload)).toBe(false);
  });

  it("rejects a resized or renumbered part", () => {
    const resized = goodParts.map((part, index) =>
      index === 0 ? { ...part, sizeBytes: part.sizeBytes - 1 } : part,
    );
    const renumbered = goodParts.map((part, index) =>
      index === 0 ? { ...part, partNumber: 9 } : part,
    );

    expect(partsCoverFile(resized, upload)).toBe(false);
    expect(partsCoverFile(renumbered, upload)).toBe(false);
  });
});
