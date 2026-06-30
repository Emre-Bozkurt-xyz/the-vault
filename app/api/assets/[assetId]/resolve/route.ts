import { NextResponse } from "next/server";

import {
  getOptionalAssetUser,
  resolveEmbeddableAssetForDocument,
} from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

/**
 * Resolves a single embeddable (public) asset for a document so the live editor
 * can render an embed whose id isn't in its server-seeded resolution map yet —
 * e.g. a public embed just pasted from the gallery. Gated by read access to the
 * document; private/own-but-unlinked assets return 404 (they wouldn't render on
 * a reload either, so the picker/link flow handles those).
 */
export async function GET(request: Request, context: RouteContext) {
  const { assetId } = await context.params;
  const documentId = new URL(request.url).searchParams.get("documentId");

  if (!documentId) {
    return NextResponse.json(
      { error: "documentId is required.", code: "DOCUMENT_ID_REQUIRED" },
      { status: 400 },
    );
  }

  const user = await getOptionalAssetUser();

  const asset = await resolveEmbeddableAssetForDocument({
    assetId,
    userId: user?.id ?? null,
    documentId,
  });

  if (!asset) {
    return NextResponse.json(
      { error: "Asset not found.", code: "ASSET_NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json({ asset });
}
