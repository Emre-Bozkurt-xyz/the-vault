/**
 * Canonical asset policy defaults.
 *
 * Per-upload caps are edited by admins at runtime (`deployment_settings`, see
 * `lib/upload-limits.ts`); the values here are what applies until an admin sets
 * one. The storage quota default feeds the `users` schema column default.
 * Client code imports this too (upload routing), so keep it dependency-free.
 */
const MiB = 1024 * 1024;

export const ASSET_LIMITS = {
  /** Default per-upload cap for images. */
  imageMaxBytes: 10 * MiB, // 10 MiB
  /** Default per-upload cap for PDFs. */
  pdfMaxBytes: 25 * MiB, // 25 MiB
  /**
   * Default per-upload cap for any other file type, which only users granted
   * unrestricted uploads may send.
   */
  fileMaxBytes: 50 * MiB, // 50 MiB
  /**
   * Largest body the single-request upload path (`POST /api/assets`) accepts.
   * It sizes Next's proxy body buffer (`next.config.ts`), which otherwise
   * truncates every request body at 10 MB, and stays under Cloudflare's 100 MB
   * proxied-request limit. Bigger files take the direct-to-R2 multipart path,
   * which never sends file bytes through Vault.
   */
  proxyBodyCeilingBytes: 95 * MiB, // 95 MiB
  /** Files above this size use the direct-to-R2 multipart path. */
  directUploadThresholdBytes: 32 * MiB, // 32 MiB
  /** Hard ceiling no admin-set per-upload cap may exceed. */
  maxUploadBytes: 5 * 1024 * MiB, // 5 GiB
  /**
   * Multipart part size floor. R2 needs every part but the last to be the same
   * size and at least 5 MiB, and allows at most 10,000 parts.
   */
  multipartPartBytes: 16 * MiB, // 16 MiB
  /** Deleted and failed asset rows are purged this long after they ended. */
  deletedAssetRetentionDays: 30,
  /** Objects younger than this are never treated as orphans (race margin). */
  orphanGraceMs: 6 * 60 * 60 * 1000, // 6 hours
  /** Default per-user storage quota applied to new users. */
  defaultUserStorageQuotaBytes: 50 * MiB, // 50 MiB
} as const;
