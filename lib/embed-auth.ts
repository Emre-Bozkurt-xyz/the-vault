import { resolveAccessToken, type ResolvedToken } from "@/lib/mcp/oauth";

/**
 * Shared bearer-token resolution for the embed/identity routes
 * (`/api/me`, `/api/embed/documents/:id/metadata`, `/api/embed/documents/:id/rendered`,
 * `/api/embed/editor-session`). Mirrors the `verifyToken` pattern in
 * `app/api/mcp/[transport]/route.ts`, which validates a bearer against the same
 * OAuth access-token store (`resolveAccessToken`, `lib/mcp/oauth.ts`) — these
 * endpoints reuse that authorization server rather than adding a second one.
 */
export async function resolveBearerToken(
  request: Request,
): Promise<ResolvedToken | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const bearerToken = match[1].trim();

  if (!bearerToken) {
    return null;
  }

  return resolveAccessToken(bearerToken);
}
