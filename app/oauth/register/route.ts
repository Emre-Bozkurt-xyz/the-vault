import { z } from "zod";

import { db } from "@/db";
import { mcpClients } from "@/db/schema";
import { randomToken } from "@/lib/mcp/oauth";
import { corsJson, corsPreflight } from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";

// Dynamic Client Registration (RFC 7591). MCP clients register themselves as
// public PKCE clients; we accept the subset of metadata they send and ignore the
// rest. No client secret is issued.
const registrationSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().max(255).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return corsJson(
      { error: "invalid_client_metadata", error_description: "Body must be JSON." },
      400,
    );
  }

  const parsed = registrationSchema.safeParse(payload);

  if (!parsed.success) {
    return corsJson(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required.",
      },
      400,
    );
  }

  const clientId = `mcp_${randomToken(18)}`;
  const grantTypes = parsed.data.grant_types ?? [
    "authorization_code",
    "refresh_token",
  ];
  const responseTypes = parsed.data.response_types ?? ["code"];

  await db.insert(mcpClients).values({
    id: clientId,
    clientName: parsed.data.client_name ?? null,
    redirectUris: parsed.data.redirect_uris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod: "none",
    scope: parsed.data.scope ?? null,
  });

  return corsJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: parsed.data.redirect_uris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
      client_name: parsed.data.client_name ?? undefined,
      scope: parsed.data.scope ?? undefined,
    },
    201,
  );
}
