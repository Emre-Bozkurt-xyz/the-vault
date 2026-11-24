import { PassThrough, Readable } from "node:stream";

import { ZipFile } from "yazl";

import { checkRateLimit } from "@/lib/rate-limit";
import { getAssetObject } from "@/lib/storage/r2";
import { zipEntryNames, zipFileName } from "@/lib/zip-names";
import {
  MAX_ZIP_FILES,
  listSharedSubtreeFiles,
  resolveShareToken,
} from "@/server/asset-share-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * "Download all" for a shared folder (`?f=` for a subfolder inside it): a zip
 * streamed straight from storage, one file at a time, never buffered whole.
 * Stored, not compressed — photos and videos are compressed already. yazl
 * switches to ZIP64 when needed, so multi-gigabyte events work. Needs the
 * link's "allow downloads".
 */
export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const share = await resolveShareToken(token);
  if (!share?.folder || !share.link.allowDownload) {
    return new Response("Not found.", { status: 404 });
  }
  if (!checkRateLimit(`share-zip:${share.link.id}:${address}`, 10, 60 * 60 * 1000).ok) {
    return new Response("Too many downloads. Try again later.", {
      status: 429,
      headers: { "Retry-After": "3600" },
    });
  }

  const folderId = new URL(request.url).searchParams.get("f") || share.folder.id;
  const files = await listSharedSubtreeFiles(share, folderId);
  if (!files) return new Response("Not found.", { status: 404 });
  if (files.length > MAX_ZIP_FILES) {
    return new Response(
      `This folder has more than ${MAX_ZIP_FILES.toLocaleString()} files. Download its subfolders one at a time.`,
      { status: 413 },
    );
  }

  const zip = new ZipFile();
  for (const entry of zipEntryNames(files)) {
    // Fetched only when the zip reaches this entry, not all at once.
    zip.addReadStreamLazy(entry.name, { size: entry.sizeBytes, compress: false }, (callback) => {
      getAssetObject(entry.storageKey)
        .then((object) => {
          const body = object.Body as { transformToWebStream?: () => ReadableStream } | undefined;
          if (!body?.transformToWebStream) throw new Error("Missing object body.");
          callback(null, Readable.fromWeb(body.transformToWebStream() as never));
        })
        .catch((error: unknown) => {
          console.error("[share-zip] could not read a file", { assetId: entry.id, error });
          callback(error, new PassThrough());
        });
    });
  }
  zip.end();

  const name = zipFileName(folderId === share.folder.id ? share.folder.name : "folder");
  return new Response(Readable.toWeb(zip.outputStream as Readable) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      // ASCII fallback plus the real (UTF-8) name for browsers that read it.
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
