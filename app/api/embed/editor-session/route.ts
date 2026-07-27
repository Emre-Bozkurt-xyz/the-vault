import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveBearerToken } from "@/lib/embed-auth";
import { canEditDocument } from "@/lib/permissions";
import { publicOrigin } from "@/lib/mcp/oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUserActiveById } from "@/server/authz";
import { mintEmbedBootToken } from "@/server/embed";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.6). Contract (§4):
// POST /api/embed/editor-session (bearer = acting user) { documentId }
//   -> { embedUrl }
//
// Steps per the plan: resolve user -> canEditDocument (404 if not) -> mint a
// single-use boot token -> return the embed URL. The boot token itself (TTL
// <=60s, single-use via jti) lives in lib/embed-boot-token.ts + server/embed.ts.
export const runtime = "nodejs";

const bodySchema = z.object({ documentId: z.string().uuid() });

export async function POST(request: Request) {
  const resolved = await resolveBearerToken(request);

  if (!resolved) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid bearer token." },
      { status: 401 },
    );
  }

  const rateLimit = checkRateLimit(`embed-editor-session:${resolved.userId}`, 20, 60_000);

  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rateLimit.retryAfterMs / 1000).toString() },
      },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "documentId must be a UUID." },
      { status: 400 },
    );
  }

  const { documentId } = parsed.data;
  const [isActive, canEdit] = await Promise.all([
    isUserActiveById(resolved.userId),
    canEditDocument(resolved.userId, documentId),
  ]);

  // A doc that doesn't exist, a doc the caller can't edit, and a banned caller
  // are all indistinguishable on the wire (AGENTS.md §4 / docs/04 §10): never
  // leak which case it is. The ban check mirrors `requireActiveUser()` on the
  // cookie-authenticated paths — moderation must not be bypassable by holding
  // an OAuth token.
  if (!isActive || !canEdit) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bootToken = mintEmbedBootToken({
    documentId,
    vaultUserId: resolved.userId,
  });

  const embedUrl = `${publicOrigin(request)}/embed/editor/${documentId}?boot=${encodeURIComponent(bootToken)}`;

  return NextResponse.json({ embedUrl }, { headers: { "Cache-Control": "no-store" } });
}
