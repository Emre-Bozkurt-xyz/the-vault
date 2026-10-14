import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UploadCancelledError,
  uploadAsset,
  type UploadProgress,
} from "@/lib/asset-upload-client";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { planMultipartUpload } from "@/lib/upload-limits";

const asset = {
  id: "asset-1",
  kind: "file",
  displayName: "big.zip",
  mimeType: "application/zip",
  sizeBytes: 0,
  url: "/api/assets/asset-1/content",
  markdown: "![[asset:asset-1|big.zip]]",
};

type XhrResult = { status: number; text?: string } | "network-error";
let xhrHandler: (method: string, url: string, body: unknown) => XhrResult;
const xhrCalls: { method: string; url: string; size: number }[] = [];

/** Just enough XMLHttpRequest for the uploader: progress, load, error, abort. */
class FakeXhr {
  status = 0;
  responseText = "";
  upload: { onprogress?: (event: { loaded: number }) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private method = "";
  private url = "";
  private aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  send(body: unknown) {
    const size = body instanceof Blob ? body.size : 0;
    xhrCalls.push({ method: this.method, url: this.url, size });

    queueMicrotask(() => {
      if (this.aborted) return;
      const result = xhrHandler(this.method, this.url, body);

      if (result === "network-error") {
        this.onerror?.();
        return;
      }

      this.upload.onprogress?.({ loaded: size });
      this.upload.onload?.();
      this.status = result.status;
      this.responseText = result.text ?? "";
      this.onload?.();
    });
  }
}

const fetchCalls: { method: string; url: string; body: unknown }[] = [];

function mockFetch(sizeBytes: number) {
  const plan = planMultipartUpload(sizeBytes);

  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    fetchCalls.push({ method, url, body: init.body });

    if (url === "/api/assets/uploads" && method === "POST") {
      return Response.json({ uploadId: "u1", ...plan }, { status: 201 });
    }

    if (url === "/api/assets/uploads/u1/parts") {
      const { partNumbers } = JSON.parse(String(init.body)) as { partNumbers: number[] };
      return Response.json({
        parts: partNumbers.map((partNumber) => ({
          partNumber,
          url: `https://r2.test/part/${partNumber}`,
        })),
      });
    }

    if (url === "/api/assets/uploads/u1/complete") {
      return Response.json({ asset: { ...asset, sizeBytes } }, { status: 201 });
    }

    if (url === "/api/assets/uploads/u1" && method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: "unexpected" }, { status: 500 });
  });
}

function bigFile(sizeBytes: number) {
  return new File([new Uint8Array(sizeBytes)], "big.zip", { type: "application/zip" });
}

beforeEach(() => {
  xhrCalls.length = 0;
  fetchCalls.length = 0;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  xhrHandler = () => ({ status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const directSize = ASSET_LIMITS.directUploadThresholdBytes + 7 * 1024 * 1024 + 3;

describe("uploadAsset (direct multipart path)", () => {
  it("sends every part once with the planned sizes and completes", async () => {
    vi.stubGlobal("fetch", mockFetch(directSize));
    const plan = planMultipartUpload(directSize);
    const progress: UploadProgress[] = [];

    const result = await uploadAsset(bigFile(directSize), {
      onProgress: (update) => progress.push(update),
    });

    expect(result.id).toBe("asset-1");

    const puts = xhrCalls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.url).sort()).toEqual(
      Array.from({ length: plan.partCount }, (_, i) => `https://r2.test/part/${i + 1}`).sort(),
    );
    expect(puts.reduce((sum, call) => sum + call.size, 0)).toBe(directSize);

    // The start request carries only the file's first 64 KiB, never the file.
    const start = fetchCalls.find((call) => call.url === "/api/assets/uploads");
    expect(((start?.body as FormData).get("head") as Blob).size).toBe(64 * 1024);

    const uploading = progress.filter((update) => update.phase === "uploading");
    expect(uploading.at(-1)?.loadedBytes).toBe(directSize);
    expect(progress.at(-1)?.phase).toBe("finishing");
    expect(fetchCalls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("retries a part after a network error", async () => {
    vi.stubGlobal("fetch", mockFetch(directSize));
    vi.useFakeTimers();
    let failed = false;
    xhrHandler = (method, url) => {
      if (url.endsWith("/part/2") && !failed) {
        failed = true;
        return "network-error";
      }
      return { status: 200 };
    };

    const upload = uploadAsset(bigFile(directSize));
    await vi.runAllTimersAsync();
    await expect(upload).resolves.toMatchObject({ id: "asset-1" });

    expect(xhrCalls.filter((call) => call.url.endsWith("/part/2"))).toHaveLength(2);
  });

  it("aborts the server-side upload when a part keeps failing", async () => {
    vi.stubGlobal("fetch", mockFetch(directSize));
    vi.useFakeTimers();
    xhrHandler = (method, url) =>
      url.endsWith("/part/1") ? "network-error" : { status: 200 };

    const upload = uploadAsset(bigFile(directSize));
    const settled = expect(upload).rejects.toThrow(/Check your connection/);
    await vi.runAllTimersAsync();
    await settled;

    expect(xhrCalls.filter((call) => call.url.endsWith("/part/1"))).toHaveLength(4);
    expect(fetchCalls.some((call) => call.method === "DELETE")).toBe(true);
    expect(fetchCalls.some((call) => call.url.endsWith("/complete"))).toBe(false);
  });

  it("cancels cleanly and releases the upload", async () => {
    vi.stubGlobal("fetch", mockFetch(directSize));
    const controller = new AbortController();
    xhrHandler = () => {
      controller.abort();
      return { status: 200 };
    };

    await expect(
      uploadAsset(bigFile(directSize), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(UploadCancelledError);
    expect(fetchCalls.some((call) => call.method === "DELETE")).toBe(true);
  });
});

describe("uploadAsset (single-request path)", () => {
  it("posts small files to /api/assets in one request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    xhrHandler = () => ({ status: 201, text: JSON.stringify({ asset }) });

    const result = await uploadAsset(bigFile(1024));

    expect(result.id).toBe("asset-1");
    expect(xhrCalls).toEqual([{ method: "POST", url: "/api/assets", size: 0 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn());
    xhrHandler = () => ({
      status: 413,
      text: JSON.stringify({ error: "Storage quota exceeded." }),
    });

    await expect(uploadAsset(bigFile(1024))).rejects.toThrow("Storage quota exceeded.");
  });
});
