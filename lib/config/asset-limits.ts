/**
 * Canonical asset policy defaults.
 *
 * These are product policy, not infrastructure config, so they live in the repo
 * (versioned, reviewable, identical across environments) rather than in `.env`.
 * The matching env vars still act as optional per-environment overrides; see
 * `getAssetUploadLimits` in `server/assets.ts` and the `users` schema default.
 */
const MiB = 1024 * 1024;

export const ASSET_LIMITS = {
  /** Per-upload cap for images (override: MAX_IMAGE_UPLOAD_BYTES). */
  imageMaxBytes: 10 * MiB, // 10 MiB
  /** Per-upload cap for PDFs (override: MAX_PDF_UPLOAD_BYTES). */
  pdfMaxBytes: 25 * MiB, // 25 MiB
  /** Default per-user storage quota applied to new users. */
  defaultUserStorageQuotaBytes: 50 * MiB, // 50 MiB
} as const;
