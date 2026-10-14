import "server-only";

import { db } from "@/db";
import { deploymentSettings } from "@/db/schema";
import {
  resolveUploadLimits,
  type UploadLimitOverrides,
  type UploadLimits,
} from "@/lib/upload-limits";

/** The admin-set upload caps, or null when no settings row exists yet. */
export async function getUploadLimitOverrides(): Promise<UploadLimitOverrides | null> {
  const [row] = await db
    .select({
      imageMaxUploadBytes: deploymentSettings.imageMaxUploadBytes,
      pdfMaxUploadBytes: deploymentSettings.pdfMaxUploadBytes,
      fileMaxUploadBytes: deploymentSettings.fileMaxUploadBytes,
    })
    .from(deploymentSettings)
    .limit(1);

  return row ?? null;
}

/**
 * Effective per-upload caps. Read on every upload (one single-row lookup), so
 * an admin change applies to the next upload without a restart.
 */
export async function getUploadLimits(): Promise<UploadLimits> {
  return resolveUploadLimits(await getUploadLimitOverrides());
}
