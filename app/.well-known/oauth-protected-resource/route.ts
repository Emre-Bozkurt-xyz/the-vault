import {
  corsJson,
  corsPreflight,
  protectedResourceMetadata,
} from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";

export function GET(request: Request) {
  return corsJson(protectedResourceMetadata(request));
}

export function OPTIONS() {
  return corsPreflight();
}
