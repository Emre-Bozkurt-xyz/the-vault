import { NextResponse } from "next/server";

import { restoreAssetFolder } from "@/server/asset-folders";
import { assetErrorResponse } from "@/server/asset-route-errors";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ folderId: string }> };

/** Takes a folder out of the Bin with everything that was binned with it. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { folderId } = await context.params;
    const folder = await restoreAssetFolder({ userId: user.id, folderId });

    return NextResponse.json({ folder });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
