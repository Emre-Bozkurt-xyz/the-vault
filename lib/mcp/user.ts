// The acting user is carried on the validated token's AuthInfo (`extra.userId`),
// populated by the MCP route's `verifyToken` — either from a bearer access token
// (OAuth, Phase 3) or, in local dev, from `MCP_DEV_USER_ID`. Tools read it here.
type McpToolExtra = {
  authInfo?: { extra?: Record<string, unknown> };
};

export function resolveMcpUserId(extra: McpToolExtra): string {
  const userId = extra.authInfo?.extra?.userId;

  if (typeof userId === "string" && userId.length > 0) {
    return userId;
  }

  throw new Error("Not authenticated.");
}
