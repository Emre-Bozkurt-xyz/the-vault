import type { AssetKind } from "@/db/schema";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { multipartPartRange } from "@/lib/upload-limits";

/**
 * Browser side of asset uploads. Small files go to `POST /api/assets` in one
 * request; files over `directUploadThresholdBytes` go straight to R2 in parts
 * (`/api/assets/uploads/...`, see `server/asset-uploads.ts`). Both report
 * byte-level progress through `onProgress`, so callers render one UI.
 */

export type UploadedAsset = {
  id: string;
  kind: AssetKind;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  markdown: string;
};

export type UploadPhase = "starting" | "uploading" | "finishing";

export type UploadProgress = {
  phase: UploadPhase;
  loadedBytes: number;
  totalBytes: number;
};

export type UploadOptions = {
  documentId?: string | null;
  shareLinkId?: string | null;
  /** Embed session token; the embed editor has no Vault cookie. */
  bearerToken?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
  }
}

const HEAD_BYTES = 64 * 1024;
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 4;
const URL_BATCH = 16;

export function uploadAsset(file: File, options: UploadOptions = {}) {
  return file.size > ASSET_LIMITS.directUploadThresholdBytes
    ? uploadDirect(file, options)
    : uploadSingle(file, options);
}

async function uploadSingle(file: File, options: UploadOptions): Promise<UploadedAsset> {
  const formData = new FormData();
  formData.set("file", file);
  if (options.documentId) formData.set("documentId", options.documentId);
  if (options.shareLinkId) formData.set("shareLinkId", options.shareLinkId);

  const total = file.size;
  options.onProgress?.({ phase: "uploading", loadedBytes: 0, totalBytes: total });

  const response = await sendXhr({
    method: "POST",
    url: "/api/assets",
    body: formData,
    headers: authHeaders(options),
    signal: options.signal,
    onUploadProgress: (loaded, sent) => {
      // `loaded` counts multipart framing too; clamp to the file size, and
      // switch to "finishing" once the server has the bytes and is storing.
      options.onProgress?.({
        phase: sent ? "finishing" : "uploading",
        loadedBytes: Math.min(loaded, total),
        totalBytes: total,
      });
    },
  });

  return readAsset(response);
}

async function uploadDirect(file: File, options: UploadOptions): Promise<UploadedAsset> {
  const total = file.size;
  options.onProgress?.({ phase: "starting", loadedBytes: 0, totalBytes: total });

  const startForm = new FormData();
  startForm.set("head", file.slice(0, Math.min(HEAD_BYTES, total)));
  startForm.set("filename", file.name);
  startForm.set("size", String(total));
  startForm.set("type", file.type);
  if (options.documentId) startForm.set("documentId", options.documentId);
  if (options.shareLinkId) startForm.set("shareLinkId", options.shareLinkId);

  const started = await requestJson<{
    uploadId: string;
    partSizeBytes: number;
    partCount: number;
  }>("/api/assets/uploads", { method: "POST", body: startForm }, options);

  const { uploadId, partSizeBytes, partCount } = started;
  const base = `/api/assets/uploads/${encodeURIComponent(uploadId)}`;

  try {
    const loadedByPart = new Map<number, number>();
    const reportProgress = () => {
      let loaded = 0;
      for (const bytes of loadedByPart.values()) loaded += bytes;
      options.onProgress?.({ phase: "uploading", loadedBytes: loaded, totalBytes: total });
    };

    const urls = new PartUrlCache(base, partCount, options);
    const queue = Array.from({ length: partCount }, (_, index) => index + 1);

    const worker = async () => {
      for (let part = queue.shift(); part !== undefined; part = queue.shift()) {
        const { start, end } = multipartPartRange(part, partSizeBytes, total);
        await uploadPart({
          part,
          blob: file.slice(start, end),
          urls,
          upcoming: queue,
          options,
          onLoaded: (bytes) => {
            loadedByPart.set(part, bytes);
            reportProgress();
          },
        });
      }
    };

    reportProgress();
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker),
    );

    options.onProgress?.({ phase: "finishing", loadedBytes: total, totalBytes: total });
    const completed = await requestJson<{ asset: UploadedAsset }>(
      `${base}/complete`,
      { method: "POST" },
      options,
    );

    return completed.asset;
  } catch (error) {
    // Releases the quota reservation and aborts the R2 side. Idempotent, so
    // safe even when the server already tore the upload down.
    void fetch(base, {
      method: "DELETE",
      headers: authHeaders(options),
      keepalive: true,
    }).catch(() => undefined);
    throw error;
  }
}

async function uploadPart(input: {
  part: number;
  blob: Blob;
  urls: PartUrlCache;
  upcoming: number[];
  options: UploadOptions;
  onLoaded: (bytes: number) => void;
}) {
  let lastError: Error | null = null;

  for (let attempt = 1; ; attempt += 1) {
    throwIfCancelled(input.options.signal);

    try {
      const url = await input.urls.get(input.part, input.upcoming);
      const response = await sendXhr({
        method: "PUT",
        url,
        body: input.blob,
        signal: input.options.signal,
        onUploadProgress: (loaded) => input.onLoaded(Math.min(loaded, input.blob.size)),
      });

      if (response.status >= 200 && response.status < 300) {
        input.onLoaded(input.blob.size);
        return;
      }

      // 403 is usually an expired signature: fetch a fresh URL next attempt.
      input.urls.forget(input.part);
      lastError = null;
    } catch (error) {
      if (error instanceof UploadCancelledError) throw error;
      lastError = error instanceof Error ? error : null;
    }

    input.onLoaded(0);

    if (attempt >= PART_ATTEMPTS) {
      throw lastError && lastError.message !== "Network error during upload."
        ? lastError
        : new Error("Upload failed. Check your connection and try again.");
    }

    await delay(1000 * 2 ** (attempt - 1), input.options.signal);
  }
}

/** Presigned part URLs, fetched in batches ahead of need. */
class PartUrlCache {
  private urls = new Map<number, string>();
  private inFlight = new Map<number, Promise<void>>();

  constructor(
    private base: string,
    private partCount: number,
    private options: UploadOptions,
  ) {}

  async get(part: number, upcoming: number[]) {
    if (!this.urls.has(part)) {
      const pending = this.inFlight.get(part);

      if (pending) {
        await pending;
      } else {
        const batch = [part, ...upcoming]
          .filter((candidate) => !this.urls.has(candidate) && !this.inFlight.has(candidate))
          .slice(0, URL_BATCH);
        const request = this.fetchBatch(batch);
        for (const candidate of batch) this.inFlight.set(candidate, request);

        try {
          await request;
        } finally {
          for (const candidate of batch) this.inFlight.delete(candidate);
        }
      }
    }

    const url = this.urls.get(part);
    if (!url) throw new Error("Could not prepare the upload.");
    return url;
  }

  forget(part: number) {
    this.urls.delete(part);
  }

  private async fetchBatch(partNumbers: number[]) {
    const valid = partNumbers.filter((part) => part >= 1 && part <= this.partCount);
    const result = await requestJson<{ parts: { partNumber: number; url: string }[] }>(
      `${this.base}/parts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumbers: valid }),
      },
      this.options,
    );

    for (const { partNumber, url } of result.parts) {
      this.urls.set(partNumber, url);
    }
  }
}

async function requestJson<T>(url: string, init: RequestInit, options: UploadOptions) {
  throwIfCancelled(options.signal);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...authHeaders(options), ...(init.headers as Record<string, string>) },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new UploadCancelledError();
    throw error;
  }

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Upload failed.");
  }

  return payload;
}

function readAsset(response: { status: number; text: string }) {
  let payload: { asset?: UploadedAsset; error?: string } = {};
  try {
    payload = JSON.parse(response.text) as typeof payload;
  } catch {
    // Non-JSON error page (proxy, gateway): fall through to a generic message.
  }

  if (response.status < 200 || response.status >= 300 || !payload.asset) {
    throw new Error(
      payload.error ??
        (response.status === 413 ? "File is too large." : "Upload failed."),
    );
  }

  return payload.asset;
}

function authHeaders(options: UploadOptions): Record<string, string> {
  return options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : {};
}

/** XHR rather than fetch: fetch has no upload progress events. */
function sendXhr(input: {
  method: string;
  url: string;
  body?: XMLHttpRequestBodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (loaded: number, sent: boolean) => void;
}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new UploadCancelledError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(input.method, input.url);

    for (const [name, value] of Object.entries(input.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    const onAbort = () => xhr.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => input.signal?.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (event) => input.onUploadProgress?.(event.loaded, false);
    // Body fully sent; the response may still take a while. Callers clamp
    // `loaded` to their own byte count.
    xhr.upload.onload = () => input.onUploadProgress?.(Number.MAX_SAFE_INTEGER, true);
    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, text: xhr.responseText });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Network error during upload."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadCancelledError());
    };

    xhr.send(input.body ?? null);
  });
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new UploadCancelledError();
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new UploadCancelledError());
      },
      { once: true },
    );
  });
}
