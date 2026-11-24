import { NextResponse } from "next/server";

import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import {
  getShareLinkForTarget,
  upsertShareLink,
  type ShareTarget,
} from "@/server/asset-share-links";
import { AssetError, requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

function targetFrom(source: { folderId?: unknown; assetId?: unknown }): ShareTarget {
  const folderId = typeof source.folderId === "string" ? source.folderId : null;
  const assetId = typeof source.assetId === "string" ? source.assetId : null;
  if ((folderId === null) === (assetId === null)) {
    throw new AssetError("Name one folder or one asset.", 400, "INVALID_SHARE_TARGET");
  }
  return folderId ? { folderId } : { assetId: assetId! };
}

/** `GET ?folderId=|assetId=`: the target's current link (or null). */
export async function GET(request: Request) {
  try {
    const user = await requireAssetUser();
    const params = new URL(request.url).searchParams;
    const target = targetFrom({
      folderId: params.get("folderId") ?? undefined,
      assetId: params.get("assetId") ?? undefined,
    });
    return NextResponse.json({ link: await getShareLinkForTarget(user.id, target) });
  } catch (error) {
    return assetErrorResponse(error);
  }
}

/**
 * `POST { folderId | assetId, allowDownload, expiresInDays: number | null }`:
 * turns "anyone with the link" on, or updates the settings of the link that
 * is already on (same URL).
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
    if (typeof body.allowDownload !== "boolean") {
      throw new AssetError("Say whether downloads are allowed.", 400, "INVALID_SHARE_SETTINGS");
    }
    const link = await upsertShareLink({
      userId: user.id,
      target: targetFrom(body),
      allowDownload: body.allowDownload,
      expiresInDays: (body.expiresInDays ?? null) as number | null,
    });
    return NextResponse.json({ link });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
