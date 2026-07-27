import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Boot tokens hand a short-lived, single-use credential to `/embed/editor/[docId]`
 * so it can identify the acting Den user without the Vault session cookie (Den
 * frames the route cross-origin; iOS Safari blocks third-party cookies).
 *
 * Same `v1.<payload>.<sig>` HMAC-off-`AUTH_SECRET` shape as `lib/collab-token.ts`,
 * kept as a sibling module rather than folded into `CollabTokenPayload` because
 * the two tokens protect different things: a collab token authorizes a live
 * Hocuspocus room for its full TTL; a boot token authorizes exactly one render
 * of the embed page. Single-use enforcement (the `jti` uniqueness check) lives
 * in `server/embed.ts`, which has DB access — this module only signs/verifies.
 */

const tokenVersion = "v1";
// Plan §C.6: TTL ≤60s.
const maxTtlSeconds = 60;

export type EmbedBootTokenPayload = {
  jti: string;
  documentId: string;
  vaultUserId: string;
  expiresAt: number;
};

type CreateEmbedBootTokenInput = {
  documentId: string;
  vaultUserId: string;
  ttlSeconds?: number;
};

export function createEmbedBootToken(input: CreateEmbedBootTokenInput): string {
  const ttlSeconds = Math.min(input.ttlSeconds ?? maxTtlSeconds, maxTtlSeconds);

  const payload: EmbedBootTokenPayload = {
    jti: randomUUID(),
    documentId: input.documentId,
    vaultUserId: input.vaultUserId,
    expiresAt: Math.floor(Date.now() / 1000) + Math.max(ttlSeconds, 1),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${tokenVersion}.${encodedPayload}.${signature}`;
}

/**
 * Verifies the token's signature and expiry only. This does NOT check or
 * record single-use — callers that need single-use semantics (the embed page)
 * must go through `consumeEmbedBootToken` in `server/embed.ts` instead.
 */
export function verifyEmbedBootTokenSignature(
  token: string,
): EmbedBootTokenPayload | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== tokenVersion || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: EmbedBootTokenPayload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as EmbedBootTokenPayload;
  } catch {
    return null;
  }

  if (
    typeof payload.jti !== "string" ||
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
    throw new Error("AUTH_SECRET is required for embed boot tokens");
  }

  return secret;
}
