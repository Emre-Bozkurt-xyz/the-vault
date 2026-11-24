import { and, eq, isNull } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { assets } from "@/db/schema";
import { assetErrorResponse, formStringOrNull } from "@/server/asset-route-errors";
import { MAX_POSTER_BYTES, scheduleServerVideoPoster, storeVideoPoster } from "@/server/asset-renditions";
import { AssetError, requireAssetUserFromRequest } from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ assetId: string }> };

/** How long `?generate=1` waits for ffmpeg before answering "still working". */
const GENERATE_WAIT_MS = 25_000;

const POSTER_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST` multipart `{ poster: image, durationMs?, width?, height? }`: the
 * poster frame and measurements the uploader's browser took from a video it
 * just uploaded. Owner only, video assets only; the image is sniffed, then
 * re-encoded through the rendition pipeline (never stored as sent).
 *
 * `POST ?generate=1` (no body): the browser couldn't capture a frame (a codec
 * it can't decode), so the server makes one with ffmpeg. Waits a little for
 * it (`{ stored: true }` lets the page refresh at once); past that it answers
 * 202 and finishes in the background. Same checks; a video that already has
 * a poster is left alone.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAssetUserFromRequest(request);
    const { assetId } = await context.params;
    if (!uuid.test(assetId)) throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");

    const [asset] = await db
      .select({
        id: assets.id,
        ownerId: assets.ownerId,
        renditionStatus: assets.renditionStatus,
        renditionVersion: assets.renditionVersion,
      })
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.ownerId, user.id),
          eq(assets.kind, "video"),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      )
      .limit(1);
    if (!asset) throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");

    if (new URL(request.url).searchParams.get("generate") === "1") {
      if (asset.renditionStatus === "ready") return NextResponse.json({ ok: true, stored: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stored = await Promise.race([
        scheduleServerVideoPoster(asset.id),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), GENERATE_WAIT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      return stored === null
        ? NextResponse.json({ ok: true, stored: false, pending: true }, { status: 202 })
        : NextResponse.json({ ok: true, stored });
    }

    const formData = await request.formData();
    const poster = formData.get("poster");
    if (!(poster instanceof Blob) || poster.size === 0 || poster.size > MAX_POSTER_BYTES) {
      throw new AssetError("Send a poster image under 2 MiB.", 400, "INVALID_POSTER");
    }

    const bytes = Buffer.from(await poster.arrayBuffer());
    const sniffed = await fileTypeFromBuffer(bytes);
    if (!sniffed || !POSTER_TYPES.has(sniffed.mime)) {
      throw new AssetError("Posters must be WebP, JPEG or PNG.", 415, "UNSUPPORTED_POSTER");
    }

    const number = (name: string) => {
      const value = Number(formStringOrNull(formData.get(name)));
      return Number.isFinite(value) ? value : null;
    };
    const stored = await storeVideoPoster({
      asset,
      bytes,
      mimeType: sniffed.mime,
      durationMs: number("durationMs"),
      width: number("width"),
      height: number("height"),
    });
    if (!stored) throw new AssetError("Could not read that poster.", 422, "INVALID_POSTER");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return assetErrorResponse(error);
  }
}
