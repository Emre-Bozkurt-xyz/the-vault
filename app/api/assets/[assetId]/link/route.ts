import { NextResponse } from "next/server";

import {
  AssetError,
  linkExistingAssetToDocument,
  requireAssetUser,
} from "@/server/assets";
import { canEditDocumentWithOptionalShareLink } from "@/server/documents";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const body = await request.json();

    if (!isLinkBody(body)) {
      throw new AssetError("Invalid asset link request.", 400, "INVALID_ASSET_LINK");
    }

    const canEdit = await canEditDocumentWithOptionalShareLink(
      user.id,
      body.documentId,
      body.shareLinkId ?? null,
    );

    if (!canEdit) {
      throw new AssetError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
    }

    const asset = await linkExistingAssetToDocument({
      userId: user.id,
      documentId: body.documentId,
      assetId,
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

function isLinkBody(value: unknown): value is {
  documentId: string;
  shareLinkId?: string | null;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;
  return (
    typeof body.documentId === "string" &&
    (body.shareLinkId === undefined ||
      body.shareLinkId === null ||
      typeof body.shareLinkId === "string")
  );
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
