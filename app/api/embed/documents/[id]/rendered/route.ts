import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { resolveBearerToken } from "@/lib/embed-auth";
import { getDocumentAccess } from "@/lib/permissions";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { listAssetResolutionsForDocument } from "@/server/assets";
import {
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

// Den Phase 3 (docs/DEN_EMBED_BRIDGE.md §B.4). Contract (§4):
// GET /api/embed/documents/:id/rendered (bearer) -> { html, assets }
//
// Runs the SAME sanitization pipeline as `/public/[slug]` and the doc page's
// read view (`MarkdownDocument`: react-markdown + rehype-raw + rehype-sanitize
// + KaTeX + wiki-link/asset-embed transforms) via `renderToStaticMarkup` —
// there is no second markdown renderer here. `runtime = "nodejs"` because
// `renderToStaticMarkup` needs the Node React DOM server build.
//
// This is a *read*-mode render, not Live mode (docs/DEN_EMBED_BRIDGE.md §B,
// "Keep this a read render"): no CodeMirror, no collab, no interactivity.
//
// Known limitation (see docs/DEN_EMBED_BRIDGE.md Status): calendar blocks and
// sticker overlays are intentionally omitted rather than forked into a second
// render path — they depend on client-side fetch/hydration that a static HTML
// snapshot never gets. `:::calendar{...}` anchors render as plain fenced
// content; sticker overlays don't render at all.
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const resolved = await resolveBearerToken(request);

  if (!resolved) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid bearer token." },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const parsedId = paramsSchema.safeParse({ id });

  if (!parsedId.success) {
    return notFound();
  }

  const documentId = parsedId.data.id;
  const access = await getDocumentAccess(resolved.userId, documentId);

  if (!access.canRead) {
    return notFound();
  }

  const [document] = await db
    .select({ id: documents.id, markdown: documents.markdown })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return notFound();
  }

  const [readableWikiLinks, guideWikiLinks, publicWikiLinks, assetLinks] =
    await Promise.all([
      listWikiLinkResolutionsForUser(resolved.userId),
      listOfficialDocWikiLinkResolutions(),
      listPublicWikiLinkResolutions(),
      listAssetResolutionsForDocument(documentId, resolved.userId, document.markdown),
    ]);
  const wikiLinks = {
    ...readableWikiLinks,
    ...publicWikiLinks,
    ...guideWikiLinks,
  };

  const html = renderToStaticMarkup(
    createElement(MarkdownDocument, {
      markdown: document.markdown,
      wikiLinks,
      assetLinks,
      documentId: document.id,
    }),
  );

  return NextResponse.json(
    { html, assets: Object.values(assetLinks) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
