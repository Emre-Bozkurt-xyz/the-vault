import { NextResponse } from "next/server";

import { assetErrorResponse } from "@/server/asset-route-errors";
import { emptyMediaBinForUser } from "@/server/asset-folders";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

/** Empty Bin: deletes every binned asset and folder the user owns, for good. */
export async function DELETE() {
  try {
    const user = await requireAssetUser();
    const { deletedAssets, deletedFolders } = await emptyMediaBinForUser(user.id);

    return NextResponse.json({
      deleted: deletedAssets.length + deletedFolders,
      freedBytes: deletedAssets.reduce((total, row) => total + row.sizeBytes, 0),
    });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
