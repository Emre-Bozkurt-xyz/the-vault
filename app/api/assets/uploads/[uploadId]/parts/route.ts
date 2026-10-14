import { NextResponse } from "next/server";
import { z } from "zod";

import { assetErrorResponse } from "@/server/asset-route-errors";
import {
  MAX_PART_URLS_PER_REQUEST,
  presignDirectUploadParts,
} from "@/server/asset-uploads";
import { AssetError, requireAssetUserFromRequest } from "@/server/assets";

export const runtime = "nodejs";

const bodySchema = z.object({
  partNumbers: z.array(z.number().int().positive()).min(1).max(MAX_PART_URLS_PER_REQUEST),
});

type RouteContext = { params: Promise<{ uploadId: string }> };

/** Presigned PUT URLs for a batch of the caller's own upload parts. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUserFromRequest(request);
    const { uploadId } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new AssetError("Request between 1 and 50 parts.", 400, "BAD_PARTS");
    }

    const parts = await presignDirectUploadParts({
      userId: user.id,
      uploadId,
      partNumbers: parsed.data.partNumbers,
    });

    return NextResponse.json({ parts });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
