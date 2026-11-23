import { NextResponse } from "next/server";

import { parseBulkAssetIds } from "@/lib/asset-lifecycle";
import { assetErrorResponse } from "@/server/asset-route-errors";
import { AssetError, requireAssetUser, restoreAssetsForUser } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

/** Takes one asset back out of the Bin. 404 unless it is the user's and binned. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { assetId } = await context.params;
    const assetIds = parseBulkAssetIds([assetId]);
    const [restored] = assetIds
      ? await restoreAssetsForUser({ userId: user.id, assetIds })
      : [];

    if (!restored) {
      throw new AssetError("Asset not found in the Bin.", 404, "ASSET_NOT_FOUND");
    }

    return NextResponse.json({ asset: { id: restored.id, status: "ready" } });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
