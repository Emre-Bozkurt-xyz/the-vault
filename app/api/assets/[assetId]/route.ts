import { NextResponse } from "next/server";

import {
  AssetError,
  getAssetForUser,
  requireAssetUser,
  softDeleteAssetForUser,
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
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const asset = await softDeleteAssetForUser({
      userId: user.id,
      assetId,
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

function isAssetUpdateBody(value: unknown): value is {
  displayName: string;
  altText?: string | null;
  description?: string | null;
  visibility: "private" | "public";
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
      typeof body.description === "string")
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
