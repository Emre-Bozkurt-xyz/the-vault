import { NextResponse } from "next/server";

import { assetErrorResponse, formStringOrNull } from "@/server/asset-route-errors";
import {
  AssetError,
  createUploadedAsset,
  listAssetsForUser,
  requireAssetUser,
  requireAssetUserFromRequest,
} from "@/server/assets";
import {
  canEditDocumentWithOptionalShareLink,
} from "@/server/documents-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireAssetUser();
    const assets = await listAssetsForUser(user.id);
    return NextResponse.json({
      assets,
      storage: {
        usedBytes: user.storageUsedBytes,
        quotaBytes: user.storageQuotaBytes,
        unrestrictedUploadsAllowed: user.unrestrictedUploadsAllowed,
      },
    });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Falls back to an embed session bearer token when there is no Vault
    // session cookie (the embed editor is framed cross-origin and gets none).
    const user = await requireAssetUserFromRequest(request);
    const formData = await request.formData();
    const file = formData.get("file");
    const documentId = formStringOrNull(formData.get("documentId"));
    const shareLinkId = formStringOrNull(formData.get("shareLinkId"));

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
      allowAnyFileType: user.unrestrictedUploadsAllowed,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
