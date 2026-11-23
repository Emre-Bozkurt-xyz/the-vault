import { NextResponse } from "next/server";

import { parseBulkAssetAction, parseBulkAssetIds } from "@/lib/asset-lifecycle";
import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import {
  AssetError,
  deleteAssetsForeverForUser,
  requireAssetUser,
  restoreAssetsForUser,
  trashAssetsForUser,
} from "@/server/assets";

export const runtime = "nodejs";

/**
 * `POST { action: "trash" | "restore" | "delete", assetIds: uuid[] }`.
 *
 * Applies one lifecycle action to many of the user's assets. Ids not in the
 * action's source state (someone else's, already binned, already restored) are
 * skipped rather than failing the batch, so retries and double submits are
 * harmless; `affected` lists the ids that actually changed. `delete` means
 * delete forever and only touches assets already in the Bin.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const action = parseBulkAssetAction(body?.action);
    const assetIds = parseBulkAssetIds(body?.assetIds);

    if (!action || !assetIds) {
      throw new AssetError("Invalid bulk request.", 400, "INVALID_BULK_REQUEST");
    }

    const input = { userId: user.id, assetIds };
    const rows =
      action === "trash"
        ? await trashAssetsForUser(input)
        : action === "restore"
          ? await restoreAssetsForUser(input)
          : await deleteAssetsForeverForUser(input);

    return NextResponse.json({ action, affected: rows.map((row) => row.id) });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
