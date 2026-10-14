import { z } from "zod";

import { ASSET_LIMITS } from "@/lib/config/asset-limits";

const MiB = 1024 * 1024;

/** R2 multipart rules: at most 10,000 parts, every part but the last ≥ 5 MiB. */
export const MAX_MULTIPART_PARTS = 10_000;

export type UploadLimits = {
  imageMaxBytes: number;
  pdfMaxBytes: number;
  fileMaxBytes: number;
};

/** The admin-set columns of `deployment_settings`; null means "default". */
export type UploadLimitOverrides = {
  imageMaxUploadBytes: number | null;
  pdfMaxUploadBytes: number | null;
  fileMaxUploadBytes: number | null;
};

/**
 * Effective per-upload caps: the admin value when set, else the repo default,
 * always clamped to the hard ceiling so a stale or hand-edited row can never
 * exceed it.
 */
export function resolveUploadLimits(
  overrides: UploadLimitOverrides | null | undefined,
): UploadLimits {
  return {
    imageMaxBytes: pick(overrides?.imageMaxUploadBytes, ASSET_LIMITS.imageMaxBytes),
    pdfMaxBytes: pick(overrides?.pdfMaxUploadBytes, ASSET_LIMITS.pdfMaxBytes),
    fileMaxBytes: pick(overrides?.fileMaxUploadBytes, ASSET_LIMITS.fileMaxBytes),
  };
}

function pick(value: number | null | undefined, fallback: number) {
  const bytes = typeof value === "number" && value > 0 ? value : fallback;
  return Math.min(bytes, ASSET_LIMITS.maxUploadBytes);
}

export const maxUploadMiB = ASSET_LIMITS.maxUploadBytes / MiB;

/**
 * One admin form field in MiB. Blank resets to the default (null); otherwise a
 * positive number up to the ceiling, stored as whole bytes.
 */
export const uploadLimitMiBSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.union([
    z.literal("").transform(() => null),
    z.coerce
      .number()
      .positive("Upload limits must be greater than zero.")
      .max(maxUploadMiB, `Upload limits can be at most ${maxUploadMiB} MiB.`)
      .transform((mib) => Math.round(mib * MiB)),
  ]),
);

/**
 * Part layout for a direct-to-R2 multipart upload: a uniform part size (whole
 * MiB, at least `multipartPartBytes`) that keeps the count within R2's limit.
 */
export function planMultipartUpload(sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new RangeError("Upload size must be a positive integer.");
  }

  const minimumForCount = Math.ceil(sizeBytes / MAX_MULTIPART_PARTS / MiB) * MiB;
  const partSizeBytes = Math.max(ASSET_LIMITS.multipartPartBytes, minimumForCount);

  return {
    partSizeBytes,
    partCount: Math.ceil(sizeBytes / partSizeBytes),
  };
}

/** Byte range of a 1-based part, end exclusive (matches `Blob.slice`). */
export function multipartPartRange(
  partNumber: number,
  partSizeBytes: number,
  sizeBytes: number,
) {
  const start = (partNumber - 1) * partSizeBytes;
  return { start, end: Math.min(start + partSizeBytes, sizeBytes) };
}

/**
 * Whether listed parts are exactly the planned layout: every part present in
 * order, each the planned size, the last one exactly the remainder.
 */
export function partsCoverFile(
  parts: { partNumber: number; sizeBytes: number }[],
  upload: { partCount: number; partSizeBytes: number; sizeBytes: number },
) {
  return (
    parts.length === upload.partCount &&
    parts.every((part, index) => {
      const { start, end } = multipartPartRange(
        index + 1,
        upload.partSizeBytes,
        upload.sizeBytes,
      );
      return part.partNumber === index + 1 && part.sizeBytes === end - start;
    })
  );
}
