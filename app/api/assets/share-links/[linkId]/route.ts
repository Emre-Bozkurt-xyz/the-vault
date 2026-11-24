import { NextResponse } from "next/server";

import { assetErrorResponse } from "@/server/asset-route-errors";
import { revokeShareLink } from "@/server/asset-share-links";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ linkId: string }> };

/** Turns the link off; it stops working at once. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUser();
    const { linkId } = await context.params;
    await revokeShareLink(user.id, linkId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
