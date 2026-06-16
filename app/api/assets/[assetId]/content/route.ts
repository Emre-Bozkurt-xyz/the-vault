import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getAssetObject } from "@/lib/storage/r2";
import { getOptionalAssetUser, getReadableAsset } from "@/server/assets";

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
  const user = await getOptionalAssetUser();
  const url = new URL(request.url);
  const documentId = url.searchParams.get("doc");
  const asset = await getReadableAsset({
    assetId,
    userId: user?.id ?? null,
    documentId,
  });

  if (!asset) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const range = parseRangeHeader(request.headers.get("range"), asset.sizeBytes);

  if (range?.status === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${asset.sizeBytes}`,
      },
    });
  }

  const headers = buildHeaders(asset, range?.status === "ok" ? range : null);

  if (headOnly) {
    return new Response(null, {
      status: range?.status === "ok" ? 206 : 200,
      headers,
    });
  }

  const object = await getAssetObject(
    asset.storageKey,
    range?.status === "ok" ? `bytes=${range.start}-${range.end}` : undefined,
  );
  const body = object.Body;

  if (!body) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new Response(toWebStream(body), {
    status: range?.status === "ok" ? 206 : 200,
    headers,
  });
}

function buildHeaders(asset: {
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
}, range: { start: number; end: number } | null) {
  const contentLength = range
    ? range.end - range.start + 1
    : asset.sizeBytes;
  const headers = new Headers({
    "Content-Type": asset.mimeType,
    "Content-Length": String(contentLength),
    "Content-Disposition": `inline; filename="${escapeHeaderValue(asset.displayName)}"`,
    "X-Content-Type-Options": "nosniff",
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

function escapeHeaderValue(value: string) {
  return value.replace(/["\\\r\n]/g, "_");
}

function readPositiveIntEnv(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
