import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import type { AssetKind } from "@/db/schema";
import { assetDeliveryHeaders } from "@/lib/asset-delivery";
import { getAssetObject } from "@/lib/storage/r2";
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
  // Falls back to the embed session token (`?embed=`) when there is no Vault
  // session cookie — an `<img>` tag can't set an Authorization header, so the
  // embed editor page threads the token through the URL instead. The token is
  // an identity assertion only: getReadableAsset below still runs its full,
  // unmodified permission check against whatever id is resolved either way.
  const user = await getOptionalAssetUserForContentRequest(request);
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

  const headers = buildHeaders(
    asset,
    range?.status === "ok" ? range : null,
    url.searchParams.get("download") === "1",
  );

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

function readPositiveIntEnv(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
