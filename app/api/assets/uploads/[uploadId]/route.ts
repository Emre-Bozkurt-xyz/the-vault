import { assetErrorResponse } from "@/server/asset-route-errors";
import { abortDirectUpload } from "@/server/asset-uploads";
import { requireAssetUserFromRequest } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ uploadId: string }> };

/** Cancels an in-flight upload and releases its quota. Idempotent. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUserFromRequest(request);
    const { uploadId } = await context.params;
    await abortDirectUpload({ userId: user.id, uploadId });

    return new Response(null, { status: 204 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
