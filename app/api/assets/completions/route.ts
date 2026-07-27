import { NextResponse } from "next/server";

import {
  AssetError,
  listAssetCompletionsForDocument,
  requireAssetUserFromRequest,
} from "@/server/assets";
import { canEditDocumentWithOptionalShareLink } from "@/server/documents";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Falls back to an embed session bearer token when there is no Vault
    // session cookie (the embed editor is framed cross-origin and gets none).
    const user = await requireAssetUserFromRequest(request);
    const url = new URL(request.url);
    const documentId = url.searchParams.get("documentId")?.trim();
    const shareLinkId = url.searchParams.get("shareLinkId")?.trim() || null;

    if (!documentId) {
      throw new AssetError("Document is required.", 400, "DOCUMENT_REQUIRED");
    }

    const canEdit = await canEditDocumentWithOptionalShareLink(
      user.id,
      documentId,
      shareLinkId,
    );

    if (!canEdit) {
      throw new AssetError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
    }

    const assets = await listAssetCompletionsForDocument({
      userId: user.id,
      documentId,
    });

    return NextResponse.json({ assets });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

function assetErrorResponse(error: unknown) {
  if (error instanceof AssetError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: "Asset operation failed.", code: "ASSET_OPERATION_FAILED" },
    { status: 500 },
  );
}
