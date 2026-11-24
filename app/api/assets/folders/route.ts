import { NextResponse } from "next/server";

import { createAssetFolder } from "@/server/asset-folders";
import { assetErrorResponse, readJsonBody } from "@/server/asset-route-errors";
import { requireAssetUser } from "@/server/assets";

export const runtime = "nodejs";

/**
 * `POST { name, parentId: uuid | null, onConflict?: "error" | "rename" }`:
 * creates a media folder. A sibling with the same name is a 409 unless
 * `onConflict: "rename"` (folder drops), which picks "Name (2)".
 */
export async function POST(request: Request) {
  try {
    const user = await requireAssetUser();
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const folder = await createAssetFolder({
      userId: user.id,
      name: body?.name,
      parentId: typeof body?.parentId === "string" ? body.parentId : null,
      onConflict: body?.onConflict === "rename" ? "rename" : "error",
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
