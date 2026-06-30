import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { registerVaultDocumentTools } from "@/lib/mcp/document-tools";
import { registerVaultDocumentWriteTools } from "@/lib/mcp/document-write-tools";
import { registerVaultExtensionTools } from "@/lib/mcp/extension-tools";
import { resolveAccessToken } from "@/lib/mcp/oauth";

// Streamable HTTP MCP endpoint. With this file at `app/api/mcp/[transport]/`
// and basePath `/api/mcp`, the streamable transport is served at
// `/api/mcp/mcp`. SSE is disabled (removed from the MCP spec as of 2025-03-26).
const baseHandler = createMcpHandler(
  (server) => {
    registerVaultDocumentTools(server);
    registerVaultDocumentWriteTools(server);
    registerVaultExtensionTools(server);
  },
  {
    serverInfo: { name: "vault", version: "0.1.0" },
  },
  {
    basePath: "/api/mcp",
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

/**
 * Resolves the bearer to an acting user. In production this is an OAuth access
 * token issued by our authorization server. In local dev, when no token is
 * presented, `MCP_DEV_USER_ID` stands in so the Inspector works without OAuth.
 * The user id rides on `AuthInfo.extra.userId`, which tools read via
 * `resolveMcpUserId`.
 */
async function verifyToken(
  _request: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (bearerToken) {
    const resolved = await resolveAccessToken(bearerToken);

    if (!resolved) {
      return undefined;
    }

    return {
      token: bearerToken,
      clientId: resolved.clientId,
      scopes: resolved.scope ? [resolved.scope] : [],
      expiresAt: resolved.expiresAtSeconds,
      extra: { userId: resolved.userId },
    };
  }

  const devUserId = process.env.MCP_DEV_USER_ID?.trim();

  if (devUserId && process.env.NODE_ENV !== "production") {
    return {
      token: "dev",
      clientId: "dev",
      scopes: [],
      extra: { userId: devUserId },
    };
  }

  return undefined;
}

const handler = withMcpAuth(baseHandler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { handler as GET, handler as POST };

export const runtime = "nodejs";
export const maxDuration = 60;
