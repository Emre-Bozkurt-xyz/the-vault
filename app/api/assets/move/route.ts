import { NextResponse } from "next/server";

import { parseMoveRequest } from "@/lib/asset-folders";
import { moveAssetItems } from "@/server/asset-folders";
import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import { AssetError, requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

/**
 * `POST { assetIds?: uuid[], folderIds?: uuid[], targetFolderId: uuid | null }`:
 * moves assets and folders into a folder (null = library root), all or
 * nothing. Returns the ids that actually moved.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const move = parseMoveRequest(await readJsonBody(request));

    if (!move) {
      throw new AssetError("Invalid move request.", 400, "INVALID_MOVE_REQUEST");
    }

    const moved = await moveAssetItems({ userId: user.id, ...move });

    return NextResponse.json({ moved });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
