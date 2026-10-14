import { NextResponse } from "next/server";

import { assetErrorResponse, formStringOrNull } from "@/server/asset-route-errors";
import {
  DIRECT_UPLOAD_HEAD_BYTES,
  startDirectUpload,
} from "@/server/asset-uploads";
import { AssetError, requireAssetUserFromRequest } from "@/server/assets";
import { canEditDocumentWithOptionalShareLink } from "@/server/documents-data";

export const runtime = "nodejs";

/**
 * Starts a direct-to-R2 multipart upload for a large file. The body carries
 * only metadata plus the file's first bytes (`head`) so the type can be sniffed
 * and rejected before any of the file is sent.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUserFromRequest(request);
    const formData = await request.formData();
    const head = formData.get("head");
    const filename = formStringOrNull(formData.get("filename")) ?? "";
    const sizeBytes = Number(formData.get("size"));
    const declaredMimeType = formStringOrNull(formData.get("type")) ?? "";
    const documentId = formStringOrNull(formData.get("documentId"));
    const shareLinkId = formStringOrNull(formData.get("shareLinkId"));

    if (!(head instanceof Blob) || head.size > DIRECT_UPLOAD_HEAD_BYTES) {
      throw new AssetError("Upload a file.", 400, "MISSING_FILE");
    }

    if (
      documentId &&
      !(await canEditDocumentWithOptionalShareLink(user.id, documentId, shareLinkId))
    ) {
      throw new AssetError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
    }

    const plan = await startDirectUpload({
      user,
      filename,
      sizeBytes,
      declaredMimeType,
      head: Buffer.from(await head.arrayBuffer()),
      documentId,
      shareLinkId,
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
