/**
 * Canonical asset policy defaults.
 *
 * Per-upload caps are edited by admins at runtime (`deployment_settings`, see
 * `lib/upload-limits.ts`); the values here are what applies until an admin sets
 * one. The storage quota default feeds the `users` schema column default.
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
   * Hard ceiling no admin-set cap may exceed. It also sizes Next's proxy body
   * buffer (`next.config.ts`), which otherwise truncates every request body
   * at 10 MB. It stays under Cloudflare's 100 MB proxied-request limit, and
   * uploads are buffered in memory, so raising it is a deploy-time decision.
   */
  uploadCeilingBytes: 95 * MiB, // 95 MiB
  /** Default per-user storage quota applied to new users. */
  defaultUserStorageQuotaBytes: 50 * MiB, // 50 MiB
} as const;
