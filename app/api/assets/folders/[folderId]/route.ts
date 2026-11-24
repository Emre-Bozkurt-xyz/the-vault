import { NextResponse } from "next/server";

import {
  deleteAssetFolderForever,
  renameAssetFolder,
  trashAssetFolder,
} from "@/server/asset-folders";
import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ folderId: string }> };

/** `PATCH { name }`: renames a live folder; 409 if a sibling has that name. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { folderId } = await context.params;
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const folder = await renameAssetFolder({ userId: user.id, folderId, name: body?.name });

    return NextResponse.json({ folder });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

/**
 * Moves the folder and everything live inside it to the Bin. `?permanent=1`
 * deletes a folder that is already in the Bin for good, with what it holds.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { folderId } = await context.params;
    const permanent = new URL(request.url).searchParams.get("permanent") === "1";
    const result = permanent
      ? await deleteAssetFolderForever({ userId: user.id, folderId })
      : await trashAssetFolder({ userId: user.id, folderId });

    return NextResponse.json({ folder: result });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
