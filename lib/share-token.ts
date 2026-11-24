import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tokens for media share links (`asset_share_links`): 44 URL-safe characters,
 * the link's uuid (16 bytes) followed by the first 16 bytes of an HMAC-SHA256
 * of it, both base64url. Nothing secret is stored — the token is recomputed
 * from the id whenever the owner wants to copy the link again — and without
 * the server secret a database dump can't produce a working link.
 *
 * Rotating `AUTH_SECRET` therefore invalidates every media share link.
 * Server-only (uses the secret); the format checks are pure for tests.
 */

const CONTEXT = "vault-asset-share:v1:";
const PART = 22; // base64url length of 16 bytes, unpadded
const tokenPattern = /^[A-Za-z0-9_-]{44}$/;

function uuidToBytes(id: string) {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("Not a uuid.");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(bytes: Buffer) {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mac(id: string, secret: string) {
  return createHmac("sha256", secret).update(`${CONTEXT}${id.toLowerCase()}`).digest().subarray(0, 16);
}

export function encodeShareToken(linkId: string, secret: string) {
  if (!secret) throw new Error("A secret is required to sign share links.");
  return `${uuidToBytes(linkId).toString("base64url")}${mac(linkId, secret).toString("base64url")}`;
}

/** The link id a token names, or null if it is malformed or not signed by `secret`. */
export function decodeShareToken(token: unknown, secret: string): string | null {
  if (!secret || typeof token !== "string" || !tokenPattern.test(token)) return null;

  const idBytes = Buffer.from(token.slice(0, PART), "base64url");
  const given = Buffer.from(token.slice(PART), "base64url");
  if (idBytes.length !== 16 || given.length !== 16) return null;

  const id = bytesToUuid(idBytes);
  // Compare the whole canonical token, not just the decoded bytes: the last
  // base64url character of each half carries unused padding bits, and a
  // byte-level check would accept several spellings of one link.
  const expected = Buffer.from(encodeShareToken(id, secret));
  return timingSafeEqual(Buffer.from(token), expected) ? id : null;
}

/** The secret share tokens are signed with; throws if the deployment has none. */
export function shareTokenSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}
