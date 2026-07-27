import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyEmbedSessionToken } from "@/lib/embed-session-token";
import { maxMarkdownLength } from "@/lib/markdown";
import { getDocumentAccess } from "@/lib/permissions";
import { isUserActiveById } from "@/server/authz";
import {
  saveDocumentTitleCore,
  saveMarkdownDocumentCore,
} from "@/server/documents";

// Den Phase 4 follow-up (docs/DEN_EMBED_BRIDGE.md §C.5/C.6 bugfix). The embed
// editor is framed cross-origin, so it never carries the Vault session
// cookie — `saveMarkdownDocumentAction`/`saveDocumentTitleAction` (both
// `requireActiveUser()`-gated) always fail inside it. This route is the
// bearer-token sibling: authenticated by a multi-use embed session token
// (`lib/embed-session-token.ts`, minted once by `/embed/editor/[docId]` when
// it redeems the boot token) instead of the cookie.
//
// The token is an identity assertion ONLY. Every call re-runs
// `getDocumentAccess` against the token's `vaultUserId` and requires
// `canEdit` — never inferred from the token's existence — so a user whose
// access is revoked mid-session loses the ability to save here immediately,
// matching the collab connect-time re-check philosophy (docs/05 §9).
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().max(maxMarkdownLength).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedId = paramsSchema.safeParse({ id });

  if (!parsedId.success) {
    return notFound();
  }

  const documentId = parsedId.data.id;
  const token = extractBearer(request);

  if (!token) {
    return notFound();
  }

  const payload = verifyEmbedSessionToken(token);

  // A token that fails verification, or one minted for a different document,
  // is treated identically to "no token" — never leak which case it is, and
  // never let a token minted for document A authorize a write to document B
  // (docs/DEN_EMBED_BRIDGE.md non-negotiable).
  if (!payload || payload.documentId !== documentId) {
    return notFound();
  }

  let json: unknown;

  try {
    json = await request.json();
  } catch {
    return badRequest("Invalid request body.");
  }

  const parsedBody = bodySchema.safeParse(json);

  if (!parsedBody.success) {
    return badRequest("Check the title and content and try saving again.");
  }

  // Re-derive access from the DB on every call. The token only ever supplies
  // identity — it must never substitute for this check.
  //
  // The ban check is part of that re-derivation: the cookie path gets it from
  // `requireActiveUser()`, which this route cannot use (it redirects). Without
  // it a banned user would keep saving until their session token expired.
  const [isActive, access] = await Promise.all([
    isUserActiveById(payload.vaultUserId),
    getDocumentAccess(payload.vaultUserId, documentId),
  ]);

  if (!isActive || !access.canEdit) {
    return notFound();
  }

  const result =
    parsedBody.data.markdown === undefined
      ? await saveDocumentTitleCore({
          documentId,
          title: parsedBody.data.title,
          actorId: payload.vaultUserId,
        })
      : await saveMarkdownDocumentCore({
          documentId,
          title: parsedBody.data.title,
          markdown: parsedBody.data.markdown,
          actorId: payload.vaultUserId,
        });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

function extractBearer(request: Request) {
  const header =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function notFound() {
  // Private-doc non-negotiable (AGENTS.md §4, docs/04 §10): a missing/invalid
  // token and a doc the caller can't edit must be indistinguishable on the
  // wire from "this document does not exist" — never a 403.
  return NextResponse.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
