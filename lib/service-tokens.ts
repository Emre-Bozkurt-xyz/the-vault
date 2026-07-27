import { createHash, randomBytes } from "node:crypto";

/**
 * Pure crypto for `service_tokens` (Den embed bridge, docs/DEN_EMBED_BRIDGE.md
 * §C.8/"Design settled"). A service token authenticates the *service itself*
 * (e.g. Den) for the owner-op APIs (`/api/embed/groups`, `/api/embed/documents`)
 * — distinct from a user's OAuth bearer, which only ever acts within that
 * user's own permissions.
 *
 * Mirrors `lib/mcp/oauth.ts`'s `sha256`/`randomToken`: only the SHA-256 hash
 * of a service token is ever persisted (`service_tokens.token_hash`); the
 * plaintext is returned to the caller exactly once, at mint time
 * (`scripts/seed-service.mjs`), and never stored or logged again.
 */

const tokenPrefix = "vst_"; // "Vault Service Token" — lets a leaked value be grepped for.

export function generateServiceTokenPlaintext(): string {
  return `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
}

export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeServiceToken(value: string): boolean {
  return value.startsWith(tokenPrefix) && value.length > tokenPrefix.length;
}
