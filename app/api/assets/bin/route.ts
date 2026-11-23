import { NextResponse } from "next/server";

import { assetErrorResponse } from "@/server/asset-route-errors";
import { emptyAssetBinForUser, requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

/** Empty Bin: deletes every binned asset the user owns, for good. */
export async function DELETE() {
  try {
    const user = await requireAssetUser();
    const deleted = await emptyAssetBinForUser(user.id);

    return NextResponse.json({
      deleted: deleted.length,
      freedBytes: deleted.reduce((total, row) => total + row.sizeBytes, 0),
    });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
