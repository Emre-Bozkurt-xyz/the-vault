import { MCP_RESOURCE_PATH, OAUTH_SCOPE, publicOrigin } from "@/lib/mcp/oauth";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

/** JSON response with permissive CORS so browser-based MCP clients can read metadata. */
export function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export function authServerMetadata(request: Request) {
  const origin = publicOrigin(request);

  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728). */
export function protectedResourceMetadata(request: Request) {
  const origin = publicOrigin(request);

  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  };
}
