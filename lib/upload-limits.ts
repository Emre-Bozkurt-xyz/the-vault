import { z } from "zod";

import { ASSET_LIMITS } from "@/lib/config/asset-limits";

const MiB = 1024 * 1024;

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
 * exceed what the proxy body buffer actually lets through.
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
  return Math.min(bytes, ASSET_LIMITS.uploadCeilingBytes);
}

export const uploadCeilingMiB = ASSET_LIMITS.uploadCeilingBytes / MiB;

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
      .max(uploadCeilingMiB, `Upload limits can be at most ${uploadCeilingMiB} MiB.`)
      .transform((mib) => Math.round(mib * MiB)),
  ]),
);
