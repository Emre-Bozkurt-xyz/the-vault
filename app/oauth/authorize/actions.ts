"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { mcpAuthCodes, mcpClients } from "@/db/schema";
import {
  OAUTH_SCOPE,
  authCodeTtlSeconds,
  randomToken,
  sha256,
} from "@/lib/mcp/oauth";
import { getCurrentUserForAccess } from "@/server/authz";

const paramsSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.string().optional(),
});

/**
 * Finalizes an authorization request. Re-validates the client and redirect URI
 * (never trusting the posted hidden fields), then either issues a one-time PKCE
 * authorization code and redirects back to the client, or returns
 * `access_denied`.
 *
 * `decision` is bound as a leading argument (via `.bind`) rather than a form
 * field: a submit button that carries `formAction` has its `name`/`value`
 * reserved by React for server-action dispatch, so it can't also carry data.
 */
export async function decideAuthorizationAction(
  decision: "approve" | "deny",
  formData: FormData,
) {
  const parsed = paramsSchema.parse({
    client_id: formData.get("client_id"),
    redirect_uri: formData.get("redirect_uri"),
    code_challenge: formData.get("code_challenge"),
    code_challenge_method: formData.get("code_challenge_method"),
    scope: formData.get("scope") || undefined,
    state: formData.get("state") || undefined,
    resource: formData.get("resource") || undefined,
  });

  const [client] = await db
    .select({ redirectUris: mcpClients.redirectUris })
    .from(mcpClients)
    .where(eq(mcpClients.id, parsed.client_id))
    .limit(1);

  // Refuse to redirect to an unregistered URI — this guards against open redirect.
  if (!client || !client.redirectUris.includes(parsed.redirect_uri)) {
    throw new Error("Unknown client or redirect URI.");
  }

  // Ensures an authenticated session (redirects to /login otherwise).
  const user = await getCurrentUserForAccess();

  const target = new URL(parsed.redirect_uri);

  if (parsed.state) {
    target.searchParams.set("state", parsed.state);
  }

  if (decision === "deny") {
    target.searchParams.set("error", "access_denied");
    redirect(target.toString());
  }

  const code = randomToken(24);

  await db.insert(mcpAuthCodes).values({
    codeHash: sha256(code),
    clientId: parsed.client_id,
    userId: user.id,
    redirectUri: parsed.redirect_uri,
    codeChallenge: parsed.code_challenge,
    codeChallengeMethod: parsed.code_challenge_method,
    scope: parsed.scope ?? OAUTH_SCOPE,
    resource: parsed.resource ?? null,
    expiresAt: new Date(Date.now() + authCodeTtlSeconds * 1000),
  });

  target.searchParams.set("code", code);
  redirect(target.toString());
}
