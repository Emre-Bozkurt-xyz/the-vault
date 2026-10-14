import { NextResponse } from "next/server";

import { assetErrorResponse } from "@/server/asset-route-errors";
import { completeDirectUpload } from "@/server/asset-uploads";
import { requireAssetUserFromRequest } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ uploadId: string }> };

/** Verifies the uploaded parts and the stored object, then makes the asset ready. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUserFromRequest(request);
    const { uploadId } = await context.params;
    const asset = await completeDirectUpload({ userId: user.id, uploadId });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
