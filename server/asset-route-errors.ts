import "server-only";

import { NextResponse } from "next/server";

import { AssetError } from "@/server/assets";

/** JSON error response for the asset API routes; unknown errors stay generic. */
export function assetErrorResponse(error: unknown) {
  if (error instanceof AssetError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: "Asset operation failed.", code: "ASSET_OPERATION_FAILED" },
    { status: 500 },
  );
}

export function formStringOrNull(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses a JSON request body, refusing anything not sent as
 * `application/json`. Session cookies are SameSite=Lax already; this keeps a
 * cross-site `text/plain` form post from ever reaching a JSON mutation.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AssetError("Send JSON.", 415, "UNSUPPORTED_MEDIA_TYPE");
  }

  try {
    return await request.json();
  } catch {
    throw new AssetError("Invalid JSON.", 400, "INVALID_JSON");
  }
}
