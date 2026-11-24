import { NextResponse } from "next/server";

import { assetErrorResponse, formStringOrNull } from "@/server/asset-route-errors";
import {
  AssetError,
  createUploadedAsset,
  listAssetsForUser,
  listBinAssetsForUser,
  requireAssetUser,
  requireAssetUserFromRequest,
  summarizeAssetsForUser,
} from "@/server/assets";
import {
  listBinFoldersForUser,
  listFoldersForUser,
  requireLiveFolder,
} from "@/server/asset-folders";
import { listSharedTargetsForUser } from "@/server/asset-share-links";
import {
  canEditDocumentWithOptionalShareLink,
} from "@/server/documents-data";

export const runtime = "nodejs";

const summaryRecentCount = 8;

export async function GET(request: Request) {
  try {
    const user = await requireAssetUser();
    const storage = {
      usedBytes: user.storageUsedBytes,
      quotaBytes: user.storageQuotaBytes,
      unrestrictedUploadsAllowed: user.unrestrictedUploadsAllowed,
    };

    const view = new URL(request.url).searchParams.get("view");

    // `?view=summary`: the sidebar's counts and recent uploads only, so its
    // payload does not grow with the library.
    if (view === "summary") {
      const [summary, folders] = await Promise.all([
        summarizeAssetsForUser(user.id, summaryRecentCount),
        listFoldersForUser(user.id),
      ]);
      return NextResponse.json({ ...summary, folders, storage });
    }

    // `?view=bin`: binned assets with when each is deleted for good.
    if (view === "bin") {
      const [assets, folders] = await Promise.all([
        listBinAssetsForUser(user.id),
        listBinFoldersForUser(user.id),
      ]);
      return NextResponse.json({ assets, folders, storage });
    }

    const [assets, folders, shared] = await Promise.all([
      listAssetsForUser(user.id),
      listFoldersForUser(user.id),
      listSharedTargetsForUser(user.id),
    ]);
    return NextResponse.json({ assets, folders, shared, storage });
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
    const folderId = await requireLiveFolder(user.id, formStringOrNull(formData.get("folderId")));

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
      folderId,
      allowAnyFileType: user.unrestrictedUploadsAllowed,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
