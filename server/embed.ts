import { lt } from "drizzle-orm";

import { db } from "@/db";
import { embedBootTokenUses } from "@/db/schema";
import {
  createEmbedBootToken,
  verifyEmbedBootTokenSignature,
  type EmbedBootTokenPayload,
} from "@/lib/embed-boot-token";

/**
 * Mints a boot token for `documentId`/`vaultUserId`. Callers must already have
 * checked `canEditDocument` — this function does not check access itself (see
 * `POST /api/embed/editor-session`, the only caller).
 */
export function mintEmbedBootToken(input: {
  documentId: string;
  vaultUserId: string;
}): string {
  return createEmbedBootToken(input);
}

/**
 * Verifies a boot token's signature/expiry and atomically marks its `jti` as
 * used. Returns the payload on a valid, first-time redemption; returns null on
 * a bad signature, an expired token, or a replay (the `jti` primary key already
 * exists). Also opportunistically prunes long-expired rows so the table stays
 * bounded without a separate cron job — tokens live at most 60 seconds, so
 * anything past its `expiresAt` is safe to drop before the insert.
 */
export async function consumeEmbedBootToken(
  token: string,
): Promise<EmbedBootTokenPayload | null> {
  const payload = verifyEmbedBootTokenSignature(token);

  if (!payload) {
    return null;
  }

  await db
    .delete(embedBootTokenUses)
    .where(lt(embedBootTokenUses.expiresAt, new Date()))
    .catch(() => {
      // Best-effort hygiene; a failed prune must never block a legitimate
      // redemption.
    });

  const inserted = await db
    .insert(embedBootTokenUses)
    .values({
      jti: payload.jti,
      documentId: payload.documentId,
      expiresAt: new Date(payload.expiresAt * 1000),
    })
    .onConflictDoNothing({ target: embedBootTokenUses.jti })
    .returning({ jti: embedBootTokenUses.jti });

  if (inserted.length === 0) {
    // Replay: the jti was already recorded (a prior render, or a concurrent
    // double-render of the same boot URL).
    return null;
  }

  return payload;
}
