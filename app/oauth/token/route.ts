import { eq } from "drizzle-orm";

import { db } from "@/db";
import { mcpAuthCodes } from "@/db/schema";
import {
  OAUTH_SCOPE,
  issueTokens,
  rotateRefreshToken,
  sha256,
  verifyPkce,
} from "@/lib/mcp/oauth";
import { corsJson, corsPreflight } from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

function tokenResponse(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  return corsJson({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: OAUTH_SCOPE,
  });
}

function oauthError(error: string, description?: string, status = 400) {
  return corsJson({ error, error_description: description }, status);
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Body must be form-encoded.");
  }

  const grantType = String(form.get("grant_type") ?? "");

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(form);
  }

  if (grantType === "refresh_token") {
    return handleRefreshToken(form);
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}

async function handleAuthorizationCode(form: FormData) {
  const code = String(form.get("code") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const codeVerifier = String(form.get("code_verifier") ?? "");

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return oauthError("invalid_request", "Missing required parameters.");
  }

  const [authCode] = await db
    .select({
      clientId: mcpAuthCodes.clientId,
      userId: mcpAuthCodes.userId,
      redirectUri: mcpAuthCodes.redirectUri,
      codeChallenge: mcpAuthCodes.codeChallenge,
      codeChallengeMethod: mcpAuthCodes.codeChallengeMethod,
      scope: mcpAuthCodes.scope,
      resource: mcpAuthCodes.resource,
      expiresAt: mcpAuthCodes.expiresAt,
    })
    .from(mcpAuthCodes)
    .where(eq(mcpAuthCodes.codeHash, sha256(code)))
    .limit(1);

  // One-time use: delete the code regardless of outcome.
  await db.delete(mcpAuthCodes).where(eq(mcpAuthCodes.codeHash, sha256(code)));

  if (!authCode) {
    return oauthError("invalid_grant", "Authorization code is invalid.");
  }

  if (authCode.expiresAt.getTime() < Date.now()) {
    return oauthError("invalid_grant", "Authorization code has expired.");
  }

  if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "Client or redirect URI mismatch.");
  }

  if (
    !verifyPkce(authCode.codeChallengeMethod, authCode.codeChallenge, codeVerifier)
  ) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  const tokens = await issueTokens({
    clientId: authCode.clientId,
    userId: authCode.userId,
    scope: authCode.scope ?? OAUTH_SCOPE,
    resource: authCode.resource,
  });

  return tokenResponse(tokens);
}

async function handleRefreshToken(form: FormData) {
  const refreshToken = String(form.get("refresh_token") ?? "");
  const clientId = String(form.get("client_id") ?? "");

  if (!refreshToken || !clientId) {
    return oauthError("invalid_request", "Missing required parameters.");
  }

  const tokens = await rotateRefreshToken(refreshToken, clientId);

  if (!tokens) {
    return oauthError("invalid_grant", "Refresh token is invalid or expired.");
  }

  return tokenResponse(tokens);
}
