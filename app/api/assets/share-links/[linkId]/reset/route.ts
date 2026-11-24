import { NextResponse } from "next/server";

import { assetErrorResponse } from "@/server/asset-route-errors";
import { resetShareLink } from "@/server/asset-share-links";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ linkId: string }> };

/** A new URL with the same settings; the old URL stops working. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { linkId } = await context.params;
    return NextResponse.json({ link: await resetShareLink(user.id, linkId) });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
