import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { mcpTokens } from "@/db/schema";

// Path of the MCP streamable endpoint (basePath `/api/mcp` + transport segment).
export const MCP_RESOURCE_PATH = "/api/mcp/mcp";
export const OAUTH_SCOPE = "vault.documents";

const accessTokenTtlSeconds = 60 * 60; // 1 hour
const refreshTokenTtlSeconds = 60 * 60 * 24 * 30; // 30 days
const authCodeTtlSeconds = 60 * 5; // 5 minutes

export { accessTokenTtlSeconds, refreshTokenTtlSeconds, authCodeTtlSeconds };

/**
 * The public origin of this app. We prefer `NEXTAUTH_URL` (already configured for
 * Auth.js) so issuer/endpoint URLs are stable behind proxies; otherwise we fall
 * back to the request origin.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXTAUTH_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function resourceUrl(request: Request): string {
  return `${publicOrigin(request)}${MCP_RESOURCE_PATH}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Verifies a PKCE code challenge against the presented verifier. Only S256 is
 * supported (the method MCP clients use); `plain` is rejected.
 */
export function verifyPkce(
  method: string,
  challenge: string,
  verifier: string,
): boolean {
  if (method !== "S256") {
    return false;
  }

  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);

  return a.length === b.length && timingSafeEqual(a, b);
}

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * Issues and persists a new access/refresh token pair for a client+user, storing
 * only their hashes.
 */
export async function issueTokens(input: {
  clientId: string;
  userId: string;
  scope: string | null;
  resource: string | null;
}): Promise<IssuedTokens> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();

  await db.insert(mcpTokens).values({
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    clientId: input.clientId,
    userId: input.userId,
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(now + accessTokenTtlSeconds * 1000),
    refreshExpiresAt: new Date(now + refreshTokenTtlSeconds * 1000),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
  };
}

export type ResolvedToken = {
  clientId: string;
  userId: string;
  scope: string | null;
  resource: string | null;
  expiresAtSeconds: number;
};

/**
 * Resolves a presented bearer access token to its owner, or null if it is
 * unknown, expired, or revoked.
 */
export async function resolveAccessToken(
  accessToken: string,
): Promise<ResolvedToken | null> {
  const [row] = await db
    .select({
      clientId: mcpTokens.clientId,
      userId: mcpTokens.userId,
      scope: mcpTokens.scope,
      resource: mcpTokens.resource,
      expiresAt: mcpTokens.expiresAt,
    })
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.accessTokenHash, sha256(accessToken)),
        isNull(mcpTokens.revokedAt),
        sql`${mcpTokens.expiresAt} > now()`,
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
    expiresAtSeconds: Math.floor(row.expiresAt.getTime() / 1000),
  };
}

/**
 * Rotates a refresh token: validates the presented refresh token, revokes the
 * old row, and issues a fresh pair. Returns null if the refresh token is unknown,
 * expired, or already revoked.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
): Promise<IssuedTokens | null> {
  const [row] = await db
    .select({
      accessTokenHash: mcpTokens.accessTokenHash,
      clientId: mcpTokens.clientId,
      userId: mcpTokens.userId,
      scope: mcpTokens.scope,
      resource: mcpTokens.resource,
    })
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.refreshTokenHash, sha256(refreshToken)),
        eq(mcpTokens.clientId, clientId),
        isNull(mcpTokens.revokedAt),
        or(
          isNull(mcpTokens.refreshExpiresAt),
          sql`${mcpTokens.refreshExpiresAt} > now()`,
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  await db
    .update(mcpTokens)
    .set({ revokedAt: sql`now()` })
    .where(eq(mcpTokens.accessTokenHash, row.accessTokenHash));

  return issueTokens({
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
  });
}
