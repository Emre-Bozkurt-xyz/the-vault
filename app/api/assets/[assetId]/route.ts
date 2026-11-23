import { NextResponse } from "next/server";

import { parseBulkAssetIds } from "@/lib/asset-lifecycle";
import {
  AssetError,
  deleteAssetsForeverForUser,
  getAssetForUser,
  requireAssetUser,
  trashAssetsForUser,
  updateAssetForUser,
} from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const asset = await getAssetForUser(user.id, assetId);

    return NextResponse.json({ asset });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const body = await request.json();

    if (!isAssetUpdateBody(body)) {
      throw new AssetError("Invalid asset update.", 400, "INVALID_ASSET_UPDATE");
    }

    const asset = await updateAssetForUser({
      userId: user.id,
      assetId,
      displayName: body.displayName,
      altText: body.altText,
      description: body.description,
      visibility: body.visibility,
      tags: body.tags,
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

/**
 * Moves the asset to the Bin. `?permanent=1` deletes it for good instead, and
 * only from the Bin: a live asset is never deleted outright by its owner.
 * Either way an id that is not in the expected state answers 404.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const assetIds = parseBulkAssetIds([assetId]);

    if (!assetIds) {
      throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
    }

    const permanent = new URL(request.url).searchParams.get("permanent") === "1";

    if (permanent) {
      const [deleted] = await deleteAssetsForeverForUser({ userId: user.id, assetIds });
      if (!deleted) {
        throw new AssetError("Asset not found in the Bin.", 404, "ASSET_NOT_FOUND");
      }
      return NextResponse.json({ asset: { id: deleted.id, status: "deleted" } });
    }

    const [trashed] = await trashAssetsForUser({ userId: user.id, assetIds });
    if (!trashed) {
      throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
    }

    return NextResponse.json({
      asset: { id: trashed.id, status: "trashed", trashedAt: trashed.trashedAt },
    });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

function isAssetUpdateBody(value: unknown): value is {
  displayName: string;
  altText?: string | null;
  description?: string | null;
  visibility: "private" | "public";
  tags?: string[];
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;
  return (
    typeof body.displayName === "string" &&
    (body.visibility === "private" || body.visibility === "public") &&
    (body.altText === undefined ||
      body.altText === null ||
      typeof body.altText === "string") &&
    (body.description === undefined ||
      body.description === null ||
      typeof body.description === "string") &&
    (body.tags === undefined ||
      (Array.isArray(body.tags) &&
        body.tags.every((tag) => typeof tag === "string")))
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
