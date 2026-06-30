import {
  authServerMetadata,
  corsJson,
  corsPreflight,
} from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";

export function GET(request: Request) {
  return corsJson(authServerMetadata(request));
}

export function OPTIONS() {
  return corsPreflight();
}
