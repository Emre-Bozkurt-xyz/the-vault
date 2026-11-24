import { NextResponse } from "next/server";

import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import { AssetError, requireAssetUser } from "@/server/assets";
import { getAssetUsageForOwner } from "@/server/asset-usage";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 1000;

function idList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IDS) return null;
  return value.every((id) => typeof id === "string" && uuid.test(id)) ? (value as string[]) : null;
}

/**
 * `POST { assetIds?: uuid[], folderIds?: uuid[] }`: which documents embed the
 * signed-in user's files (folders count everything inside them). Only the
 * user's own files are looked at; documents they can't open are counted, not
 * named. Read-only: used to warn before binning or deleting, and by Details.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const assetIds = idList(body?.assetIds);
    const folderIds = idList(body?.folderIds);
    if (!assetIds || !folderIds) {
      throw new AssetError("Invalid usage request.", 400, "INVALID_USAGE_REQUEST");
    }
    const usage = await getAssetUsageForOwner(user.id, { assetIds, folderIds });
    return NextResponse.json({ usage });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
