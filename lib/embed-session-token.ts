import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Embed session tokens carry the acting Den user's identity across the many
 * requests a live embed editing session makes (save, asset reads, asset
 * completions, wiki-link lookups) once `/embed/editor/[docId]` has redeemed a
 * boot token. They exist because the embed editor is framed cross-origin —
 * the browser never sends the Vault session cookie there (iOS Safari blocks
 * third-party cookies even if we tried `SameSite=None`/CHIPS), so every
 * cookie-dependent request inside the iframe needs a bearer-style substitute.
 *
 * Same `v1.<payload>.<sig>` HMAC-off-`AUTH_SECRET` shape as
 * `lib/collab-token.ts` and `lib/embed-boot-token.ts`, but unlike the boot
 * token (single-use, TTL <=60s, gates one page render) this is **multi-use**:
 * it authenticates many requests over the whole editing session, so it needs
 * no `jti`/replay table. TTL mirrors `lib/collab-token.ts`'s 4-hour default
 * since it authorizes the same editing session.
 *
 * Security contract (docs/DEN_EMBED_BRIDGE.md, the follow-up slice that added
 * this file): this token is an **identity assertion only**. Every route that
 * accepts it must still re-run the real DB permission check
 * (`getDocumentAccess`/`getReadableAsset`/etc.) against the resolved
 * `vaultUserId` — the token itself grants no rights. Treat it as a bearer
 * credential: never log it, never put it in a redirect Location header, and
 * set `Cache-Control: no-store` on any response that returns or embeds one.
 */

const tokenVersion = "v1";
// Mirrors lib/collab-token.ts's default — this token authorizes the same
// live editing session as the collab room token.
const defaultTtlSeconds = 60 * 60 * 4;

export type EmbedSessionTokenPayload = {
  documentId: string;
  vaultUserId: string;
  expiresAt: number;
};

type CreateEmbedSessionTokenInput = {
  documentId: string;
  vaultUserId: string;
  ttlSeconds?: number;
};

export function createEmbedSessionToken(input: CreateEmbedSessionTokenInput): string {
  const payload: EmbedSessionTokenPayload = {
    documentId: input.documentId,
    vaultUserId: input.vaultUserId,
    expiresAt: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? defaultTtlSeconds),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${tokenVersion}.${encodedPayload}.${signature}`;
}

/**
 * Verifies the token's signature and expiry and returns its payload, or null
 * if the token is malformed, tampered with, or expired. Callers MUST still
 * re-check DB permissions for `payload.vaultUserId` before honoring the
 * request — this function only answers "who is asking", never "are they
 * allowed".
 */
export function verifyEmbedSessionToken(token: string): EmbedSessionTokenPayload | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== tokenVersion || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: EmbedSessionTokenPayload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as EmbedSessionTokenPayload;
  } catch {
    return null;
  }

  if (
    typeof payload.documentId !== "string" ||
    typeof payload.vaultUserId !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return null;
  }

  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSecret() {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "vault-development-only-auth-secret");

  if (!secret) {
    throw new Error("AUTH_SECRET is required for embed session tokens");
  }

  return secret;
}
