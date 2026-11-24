import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Video uploads (docs/26 slice 5): what the sniffer accepts as `video`, the
 * per-kind cap, and that a renamed file can't pass as a video. Pure apart
 * from the upload limits, which are mocked.
 */

const limits = vi.hoisted(() => ({
  imageMaxBytes: 10,
  pdfMaxBytes: 10,
  videoMaxBytes: 1000,
  fileMaxBytes: 10,
}));
vi.mock("@/server/deployment-settings", () => ({ getUploadLimits: async () => limits }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/db", () => ({ db: {} }));

const { classifyAssetBytes } = await import("@/server/assets");
const { servableRenditionVersion, RENDITION_VERSION } = await import("@/lib/asset-renditions");
const { assetTypeLabel } = await import("@/components/assets/asset-ui");

const ftyp = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftyp"),
    Buffer.from(brand),
    Buffer.alloc(4),
    Buffer.from(brand),
    Buffer.from("isom"),
    Buffer.alloc(64),
  ]);
const webm = Buffer.concat([
  Buffer.from("1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102", "hex"),
  Buffer.alloc(64),
]);

describe("classifyAssetBytes for video", () => {
  beforeEach(() => {
    limits.videoMaxBytes = 1000;
  });

  it.each([
    ["MP4", ftyp("mp42"), "video/mp4", "mp4"],
    ["MOV", ftyp("qt  "), "video/quicktime", "mov"],
    ["M4V", ftyp("M4V "), "video/x-m4v", "m4v"],
    ["WebM", webm, "video/webm", "webm"],
  ])("recognises %s from its bytes", async (_name, head, mime, extension) => {
    await expect(
      classifyAssetBytes({ head, sizeBytes: 500, filename: "clip.bin", declaredMimeType: "" }),
    ).resolves.toEqual({ kind: "video", mimeType: mime, detectedMimeType: mime, extension });
  });

  it("applies the video cap, not the image or PDF one", async () => {
    await expect(
      classifyAssetBytes({ head: ftyp("mp42"), sizeBytes: 1000, filename: "a.mp4" }),
    ).resolves.toMatchObject({ kind: "video" });
    await expect(
      classifyAssetBytes({ head: ftyp("mp42"), sizeBytes: 1001, filename: "a.mp4" }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("refuses a file that only claims to be a video", async () => {
    await expect(
      classifyAssetBytes({
        head: Buffer.from("<html><script>alert(1)</script></html>"),
        sizeBytes: 40,
        filename: "clip.mp4",
        declaredMimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ status: 415 });
    // Bytes of one video type declared as another.
    await expect(
      classifyAssetBytes({ head: webm, sizeBytes: 100, filename: "a.mp4", declaredMimeType: "video/mp4" }),
    ).rejects.toMatchObject({ status: 415 });
  });
});

describe("servableRenditionVersion", () => {
  const image = { kind: "image", mimeType: "image/jpeg" };
  const video = { kind: "video", mimeType: "video/mp4" };

  it("serves images at the current version unless rendering failed for it", () => {
    expect(servableRenditionVersion({ ...image, renditionStatus: "none", renditionVersion: null })).toBe(RENDITION_VERSION);
    expect(
      servableRenditionVersion({ ...image, renditionStatus: "failed", renditionVersion: RENDITION_VERSION }),
    ).toBeNull();
  });

  it("serves a video's poster at the version it was stored with, and nothing before one exists", () => {
    expect(servableRenditionVersion({ ...video, renditionStatus: "none", renditionVersion: null })).toBeNull();
    expect(servableRenditionVersion({ ...video, renditionStatus: "ready", renditionVersion: 1 })).toBe(1);
  });

  it("gives PDFs and files none", () => {
    expect(
      servableRenditionVersion({ kind: "pdf", mimeType: "application/pdf", renditionStatus: "none", renditionVersion: null }),
    ).toBeNull();
  });
});

describe("assetTypeLabel", () => {
  it("names video formats", () => {
    expect(assetTypeLabel({ kind: "video", mimeType: "video/mp4", displayName: "a.mp4" })).toBe("MP4 video");
    expect(assetTypeLabel({ kind: "video", mimeType: "video/quicktime", displayName: "a.mov" })).toBe("MOV video");
    expect(assetTypeLabel({ kind: "video", mimeType: "video/x-m4v", displayName: "a.m4v" })).toBe("M4V video");
  });
});
