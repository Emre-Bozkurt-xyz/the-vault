import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assets, type AssetKind } from "@/db/schema";
import { assetDeliveryHeaders } from "@/lib/asset-delivery";
import {
  isRenditionName,
  renditionKey,
  servableRenditionVersion,
  supportsRenditions,
  type RenditionName,
} from "@/lib/asset-renditions";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAssetObject } from "@/lib/storage/r2";
import { ensureRenditions } from "@/server/asset-renditions";
import { getAssetViaShare, resolveShareToken } from "@/server/asset-share-links";
import {
  getOptionalAssetUserForContentRequest,
  getReadableAsset,
} from "@/server/assets";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  return serveAsset(request, context, false);
}

export async function HEAD(request: Request, context: RouteContext) {
  return serveAsset(request, context, true);
}

async function serveAsset(
  request: Request,
  context: RouteContext,
  headOnly: boolean,
) {
  const { assetId } = await context.params;
  const url = new URL(request.url);
  const shareToken = url.searchParams.get("s");
  const rendition = url.searchParams.get("r");
  const download = url.searchParams.get("download") === "1";

  // `?s=<token>`: a media share link (docs/26 §9). The link alone decides —
  // no session involved — and renditions are always viewable while originals
  // need "allow downloads", except that a video may stream for playback.
  if (shareToken !== null) {
    const share = await resolveShareToken(shareToken);
    const limited =
      share &&
      !checkRateLimit(`share-content:${share.link.id}:${clientAddress(request)}`, 1200, 60_000).ok;
    if (limited) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const asset = share ? await getAssetViaShare(share, assetId) : null;
    if (!share || !asset) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (rendition !== null) {
      return serveRendition(asset, rendition, headOnly, "private, max-age=300");
    }
    const mayServeOriginal =
      share.link.allowDownload || (asset.kind === "video" && !download);
    if (!mayServeOriginal) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return serveOriginal(request, asset, headOnly, download, "private, no-store");
  }

  // Falls back to the embed session token (`?embed=`) when there is no Vault
  // session cookie — an `<img>` tag can't set an Authorization header, so the
  // embed editor page threads the token through the URL instead. The token is
  // an identity assertion only: getReadableAsset below still runs its full,
  // unmodified permission check against whatever id is resolved either way.
  const user = await getOptionalAssetUserForContentRequest(request);
  const documentId = url.searchParams.get("doc");
  const asset = await getReadableAsset({
    assetId,
    userId: user?.id ?? null,
    documentId,
  });

  if (!asset) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // `?r=thumb|display`: a rendition, behind exactly the same permission
  // check as the original above.
  if (rendition !== null) {
    return serveRendition(asset, rendition, headOnly);
  }

  return serveOriginal(request, asset, headOnly, download);
}

/** The asset's own bytes, with byte-range support (video seeking, resumes). */
async function serveOriginal(
  request: Request,
  asset: ReadableAsset,
  headOnly: boolean,
  download: boolean,
  cacheControl?: string,
) {
  const range = parseRangeHeader(request.headers.get("range"), asset.sizeBytes);

  if (range?.status === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${asset.sizeBytes}`,
      },
    });
  }

  const headers = buildHeaders(asset, range?.status === "ok" ? range : null, download);
  if (cacheControl) headers.set("Cache-Control", cacheControl);

  if (headOnly) {
    return new Response(null, {
      status: range?.status === "ok" ? 206 : 200,
      headers,
    });
  }

  // A row whose object is gone (manual bucket cleanup, a restore into another
  // bucket) is a missing asset, not a server error.
  const object = await getAssetObject(
    asset.storageKey,
    range?.status === "ok" ? `bytes=${range.start}-${range.end}` : undefined,
  ).catch((error: unknown) => {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  });
  const body = object?.Body;

  if (!body) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new Response(toWebStream(body), {
    status: range?.status === "ok" ? 206 : 200,
    headers,
  });
}

type ReadableAsset = NonNullable<Awaited<ReturnType<typeof getReadableAsset>>>;

/**
 * Serves a thumbnail or display copy, rendering it first if this image has
 * none yet. 404 when the asset has no renditions (not an image, or rendering
 * failed); 503 when storage failed, so nothing is recorded as broken.
 */
async function serveRendition(
  asset: ReadableAsset,
  name: string,
  headOnly: boolean,
  cacheControl?: string,
) {
  const version = isRenditionName(name) ? servableRenditionVersion(asset) : null;
  if (!isRenditionName(name) || version === null) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Images render here on first request; video posters were stored at upload.
  if (supportsRenditions(asset)) {
    let available: boolean;
    try {
      available = await ensureRenditions(asset);
    } catch (error) {
      console.error("[asset-renditions] render on request failed", { assetId: asset.id, error });
      return NextResponse.json(
        { error: "Try again shortly." },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }

    if (!available) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  const key = renditionKey({
    ownerId: asset.ownerId,
    assetId: asset.id,
    version,
    name,
  });
  const object = await getAssetObject(key).catch((error: unknown) => {
    if (error instanceof Error && error.name === "NoSuchKey") return null;
    throw error;
  });

  if (!object?.Body) {
    // The row says ready but the object is gone (manual bucket cleanup): mark
    // it unrendered so the next request renders it again.
    await db
      .update(assets)
      .set({ renditionStatus: "none" })
      .where(eq(assets.id, asset.id));
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": "image/webp",
    "Content-Disposition": `inline; filename="${renditionFilename(name)}"`,
    "X-Content-Type-Options": "nosniff",
    // The URL carries the version and the bytes behind it never change, so
    // browsers may keep it; private assets stay out of shared caches.
    "Cache-Control":
      cacheControl ??
      (asset.visibility === "public"
        ? `public, max-age=${readPositiveIntEnv("ASSET_PUBLIC_CACHE_SECONDS", 3600)}, stale-while-revalidate=86400`
        : "private, max-age=3600"),
  });
  if (typeof object.ContentLength === "number") {
    headers.set("Content-Length", String(object.ContentLength));
  }

  return new Response(headOnly ? null : toWebStream(object.Body), { status: 200, headers });
}

function renditionFilename(name: RenditionName) {
  return `${name}.webp`;
}

function buildHeaders(asset: {
  displayName: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
}, range: { start: number; end: number } | null, download: boolean) {
  const contentLength = range
    ? range.end - range.start + 1
    : asset.sizeBytes;
  const headers = new Headers({
    ...assetDeliveryHeaders(asset, { download }),
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
  });

  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${asset.sizeBytes}`,
    );
  }

  headers.set(
    "Cache-Control",
    asset.visibility === "public"
      ? `public, max-age=${readPositiveIntEnv(
          "ASSET_PUBLIC_CACHE_SECONDS",
          3600,
        )}, stale-while-revalidate=86400`
      : `private, max-age=${readPositiveIntEnv("ASSET_PRIVATE_CACHE_SECONDS", 0)}`,
  );

  return headers;
}

function parseRangeHeader(rangeHeader: string | null, sizeBytes: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    return { status: "invalid" as const };
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return { status: "invalid" as const };
  }

  let start: number;
  let end: number;

  if (!startText) {
    const suffixLength = Number(endText);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { status: "invalid" as const };
    }

    start = Math.max(sizeBytes - suffixLength, 0);
    end = sizeBytes - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : sizeBytes - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return { status: "invalid" as const };
  }

  return {
    status: "ok" as const,
    start,
    end: Math.min(end, sizeBytes - 1),
  };
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) {
    return body as ReadableStream<Uint8Array>;
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return body.transformToWebStream() as ReadableStream<Uint8Array>;
  }

  return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
}

/** Best-effort client address for rate limits (behind Cloudflare and Caddy). */
function clientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function readPositiveIntEnv(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
