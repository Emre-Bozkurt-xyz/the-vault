import { NextResponse } from "next/server";

import {
  AssetError,
  createUploadedAsset,
  listAssetsForUser,
  requireAssetUser,
} from "@/server/assets";
import { canEditDocumentWithOptionalShareLink } from "@/server/documents";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireAssetUser();
    const assets = await listAssetsForUser(user.id);
    return NextResponse.json({ assets });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const formData = await request.formData();
    const file = formData.get("file");
    const documentId = stringOrNull(formData.get("documentId"));
    const shareLinkId = stringOrNull(formData.get("shareLinkId"));

    if (!(file instanceof File)) {
      throw new AssetError("Upload a file.", 400, "MISSING_FILE");
    }

    if (documentId) {
      const canEdit = await canEditDocumentWithOptionalShareLink(
        user.id,
        documentId,
        shareLinkId,
      );

      if (!canEdit) {
        throw new AssetError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
      }
    }

    const asset = await createUploadedAsset({
      userId: user.id,
      file,
      documentId,
    });

    return NextResponse.json({ asset }, { status: 201 });
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

function stringOrNull(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
