import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renditions end to end against a real Postgres (docs/26 §11): generation,
 * de-duplication, permanent vs transient failures, cleanup on delete, the
 * backfill, and the content route's `?r=` permission path. Skipped unless
 * `TEST_DATABASE_URL` points at a migrated database. The bucket is an
 * in-memory map; rows are throwaway (two fresh users, cascaded away after).
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/asset-renditions
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

const bucket = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  puts: [] as string[],
  reads: [] as string[],
  failReads: false,
}));

vi.mock("@/lib/storage/r2", () => {
  const noSuchKey = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  return {
    getR2Bucket: () => "test-bucket",
    putAssetObject: async (input: { key: string; body: Buffer }) => {
      bucket.puts.push(input.key);
      bucket.objects.set(input.key, Buffer.from(input.body));
    },
    deleteAssetObject: async (key: string) => {
      bucket.objects.delete(key);
    },
    getAssetObject: async (key: string) => {
      bucket.reads.push(key);
      if (bucket.failReads) throw new Error("R2 is down");
      const body = bucket.objects.get(key);
      if (!body) throw noSuchKey();
      return {
        ContentLength: body.byteLength,
        Body: {
          transformToByteArray: async () => new Uint8Array(body),
          transformToWebStream: () => new Blob([new Uint8Array(body)]).stream(),
        },
      };
    },
    listAssetObjects: async () => [],
  };
});

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/auth", () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
}));

describe.skipIf(!databaseUrl)("asset renditions (database)", () => {
  type Db = typeof import("@/db");
  let db: Db["db"];
  let client: Db["client"];
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let renditions: typeof import("@/server/asset-renditions");
  let assetsServer: typeof import("@/server/assets");
  let lib: typeof import("@/lib/asset-renditions");

  const ownerId = randomUUID();
  const strangerId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    renditions = await import("@/server/asset-renditions");
    assetsServer = await import("@/server/assets");
    lib = await import("@/lib/asset-renditions");

    await db.insert(schema.users).values([
      { id: ownerId, name: "Rendition test owner", storageQuotaBytes: 1e9 },
      { id: strangerId, name: "Rendition test stranger", storageQuotaBytes: 1e9 },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, strangerId]));
    await client.end();
  });

  beforeEach(async () => {
    bucket.objects.clear();
    bucket.puts.length = 0;
    bucket.reads.length = 0;
    bucket.failReads = false;
    session.userId = null;
    await db.delete(schema.assets).where(orm.eq(schema.assets.ownerId, ownerId));
  });

  async function cameraJpeg() {
    return sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#884422" } })
      .jpeg()
      .withExif({
        IFD2: { DateTimeOriginal: "2026:10:01 09:30:15" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
  }

  /** A ready image asset whose original sits in the fake bucket. */
  async function seedImage(original: Buffer, extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    const storageKey = `users/${ownerId}/assets/${id}.jpg`;
    bucket.objects.set(storageKey, original);
    await db.insert(schema.assets).values({
      id,
      ownerId,
      uploaderId: ownerId,
      storageBucket: "test-bucket",
      storageKey,
      originalFilename: "DSC0001.JPG",
      displayName: "DSC0001.JPG",
      mimeType: "image/jpeg",
      detectedMimeType: "image/jpeg",
      fileExtension: "jpg",
      sizeBytes: original.byteLength,
      kind: "image",
      status: "ready",
      ...extra,
    });
    return { id, storageKey };
  }

  async function row(id: string) {
    const [found] = await db
      .select({
        id: schema.assets.id,
        ownerId: schema.assets.ownerId,
        storageKey: schema.assets.storageKey,
        kind: schema.assets.kind,
        mimeType: schema.assets.mimeType,
        renditionStatus: schema.assets.renditionStatus,
        renditionVersion: schema.assets.renditionVersion,
        width: schema.assets.width,
        height: schema.assets.height,
        takenAt: schema.assets.takenAt,
        status: schema.assets.status,
      })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, id));
    return found;
  }

  const keyFor = (id: string, name: "thumb" | "display") =>
    lib.renditionKey({ ownerId, assetId: id, version: lib.RENDITION_VERSION, name });

  it("renders upright, metadata-free WebP renditions once, even when asked twice at once", async () => {
    const { id } = await seedImage(await cameraJpeg());
    const asset = await row(id);

    const [first, second] = await Promise.all([
      renditions.ensureRenditions(asset),
      renditions.ensureRenditions(asset),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    // One render: two objects written, not four.
    expect(bucket.puts.sort()).toEqual([keyFor(id, "display"), keyFor(id, "thumb")].sort());

    const after = await row(id);
    expect(after).toMatchObject({
      renditionStatus: "ready",
      renditionVersion: lib.RENDITION_VERSION,
      // EXIF orientation 6: the stored landscape pixels display as portrait.
      width: 1200,
      height: 1600,
    });
    // EXIF "date taken" is kept as the camera's wall clock.
    expect(after.takenAt?.toISOString()).toBe("2026-10-01T09:30:15.000Z");

    const thumb = await sharp(bucket.objects.get(keyFor(id, "thumb"))!).metadata();
    // 1200×1600 fitted into the 640×1920 thumbnail box.
    expect(thumb).toMatchObject({ format: "webp", width: 640, height: 853 });
    expect(thumb.exif).toBeUndefined();

    // Already current: nothing more is read or written.
    bucket.reads.length = 0;
    expect(await renditions.ensureRenditions(after)).toBe(true);
    expect(bucket.reads).toEqual([]);
  });

  it("records an undecodable image as failed and does not retry it", async () => {
    const { id } = await seedImage(Buffer.from("this is not a jpeg at all"));

    expect(await renditions.ensureRenditions(await row(id))).toBe(false);
    const failed = await row(id);
    expect(failed).toMatchObject({ renditionStatus: "failed", renditionVersion: lib.RENDITION_VERSION });

    bucket.reads.length = 0;
    expect(await renditions.ensureRenditions(failed)).toBe(false);
    expect(bucket.reads).toEqual([]);
    // Lists stop offering a thumbnail, so the browser shows a tile, not a 404.
    expect(assetsServer.buildAssetRenditionUrls(failed).thumbUrl).toBeNull();
  });

  it("treats a storage outage as transient: rejects, records nothing", async () => {
    const { id } = await seedImage(await cameraJpeg());
    bucket.failReads = true;

    await expect(renditions.ensureRenditions(await row(id))).rejects.toThrow("R2 is down");
    expect((await row(id)).renditionStatus).toBe("none");

    bucket.failReads = false;
    expect(await renditions.ensureRenditions(await row(id))).toBe(true);
  });

  it("answers 'no rendition' for a missing original without recording a failure", async () => {
    const { id, storageKey } = await seedImage(await cameraJpeg());
    bucket.objects.delete(storageKey);

    expect(await renditions.ensureRenditions(await row(id))).toBe(false);
    expect((await row(id)).renditionStatus).toBe("none");
  });

  it("cleans up after itself when the asset is deleted for good mid-render", async () => {
    const { id } = await seedImage(await cameraJpeg());
    const stale = await row(id);
    await db
      .update(schema.assets)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(orm.eq(schema.assets.id, id));

    expect(await renditions.ensureRenditions(stale)).toBe(false);
    expect(bucket.objects.has(keyFor(id, "thumb"))).toBe(false);
    expect(bucket.objects.has(keyFor(id, "display"))).toBe(false);
  });

  it("deleting forever removes the renditions with the original", async () => {
    const { id, storageKey } = await seedImage(await cameraJpeg());
    await renditions.ensureRenditions(await row(id));
    expect(bucket.objects.has(keyFor(id, "thumb"))).toBe(true);

    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [id] });
    await assetsServer.deleteAssetsForeverForUser({ userId: ownerId, assetIds: [id] });

    expect(bucket.objects.has(storageKey)).toBe(false);
    expect(bucket.objects.has(keyFor(id, "thumb"))).toBe(false);
    expect(bucket.objects.has(keyFor(id, "display"))).toBe(false);
  });

  it("backfills older images, binned ones included, and skips failures", async () => {
    const live = await seedImage(await cameraJpeg());
    const binned = await seedImage(await cameraJpeg(), { status: "trashed", trashedAt: new Date() });
    const broken = await seedImage(Buffer.from("nope"), {
      renditionStatus: "failed",
      renditionVersion: lib.RENDITION_VERSION,
    });

    // Other users' rows may be waiting too; a generous limit covers ours.
    await renditions.backfillRenditions({ limit: 1000, deadline: Date.now() + 60_000 });

    expect((await row(live.id)).renditionStatus).toBe("ready");
    expect((await row(binned.id)).renditionStatus).toBe("ready");
    expect(bucket.reads).not.toContain(broken.storageKey);
  });

  it("serves renditions through the same permission check as the original", async () => {
    const { id } = await seedImage(await cameraJpeg());
    const { GET } = await import("@/app/api/assets/[assetId]/content/route");
    const request = (query: string) =>
      GET(new Request(`http://vault.test/api/assets/${id}/content${query}`), {
        params: Promise.resolve({ assetId: id }),
      });

    session.userId = ownerId;
    const thumb = await request("?r=thumb&v=1");
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("cache-control")).toBe("private, max-age=3600");
    const bytes = Buffer.from(await thumb.arrayBuffer());
    expect((await sharp(bytes).metadata()).format).toBe("webp");

    expect((await request("?r=original")).status).toBe(404);

    // A private asset's rendition is as private as the asset.
    session.userId = strangerId;
    expect((await request("?r=thumb")).status).toBe(404);
    session.userId = null;
    expect((await request("?r=thumb")).status).toBe(404);
  });

  it("stores a video's poster as its renditions, through the owner-only poster route", async () => {
    const id = randomUUID();
    await db.insert(schema.assets).values({
      id,
      ownerId,
      uploaderId: ownerId,
      storageBucket: "test-bucket",
      storageKey: `users/${ownerId}/assets/${id}.mp4`,
      originalFilename: "MVI_0001.MP4",
      displayName: "MVI_0001.MP4",
      mimeType: "video/mp4",
      detectedMimeType: "video/mp4",
      fileExtension: "mp4",
      sizeBytes: 5000,
      kind: "video",
      status: "ready",
    });
    const { POST } = await import("@/app/api/assets/[assetId]/poster/route");
    const post = async (poster: Blob, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.set("poster", poster, "poster");
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return POST(new Request(`http://vault.test/api/assets/${id}/poster`, { method: "POST", body: form }), {
        params: Promise.resolve({ assetId: id }),
      });
    };
    const frame = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#225588" } })
      .webp()
      .toBuffer();

    // Someone else's video: as if it doesn't exist.
    session.userId = strangerId;
    expect((await post(new Blob([new Uint8Array(frame)]))).status).toBe(404);

    session.userId = ownerId;
    // Not an image.
    expect((await post(new Blob(["<svg onload=alert(1)>"]))).status).toBe(415);

    const stored = await post(new Blob([new Uint8Array(frame)]), {
      durationMs: "42500",
      width: "3840",
      height: "2160",
    });
    expect(stored.status).toBe(200);
    expect(bucket.objects.has(keyFor(id, "thumb"))).toBe(true);
    expect(bucket.objects.has(keyFor(id, "display"))).toBe(true);
    const [row] = await db
      .select({
        status: schema.assets.renditionStatus,
        version: schema.assets.renditionVersion,
        width: schema.assets.width,
        height: schema.assets.height,
        durationMs: schema.assets.durationMs,
      })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, id));
    expect(row).toMatchObject({ status: "ready", version: lib.RENDITION_VERSION, width: 3840, height: 2160, durationMs: 42500 });

    // Lists point at the stored version, and the content route serves it.
    const urls = assetsServer.buildAssetRenditionUrls({ id, kind: "video", mimeType: "video/mp4", renditionStatus: "ready", renditionVersion: lib.RENDITION_VERSION });
    expect(urls.thumbUrl).toContain(`r=thumb&v=${lib.RENDITION_VERSION}`);
    const { GET } = await import("@/app/api/assets/[assetId]/content/route");
    const thumb = await GET(new Request(`http://vault.test/api/assets/${id}/content?r=thumb`), {
      params: Promise.resolve({ assetId: id }),
    });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");

    // Absurd measurements are clamped rather than stored.
    await post(new Blob([new Uint8Array(frame)]), { durationMs: "1e12", width: "-5", height: "nope" });
    const [clamped] = await db
      .select({ width: schema.assets.width, height: schema.assets.height, durationMs: schema.assets.durationMs })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, id));
    expect(clamped).toEqual({ width: 1280, height: 720, durationMs: 24 * 60 * 60 * 1000 });
  });

  it("gives document image embeds a display URL through the document's grant", async () => {
    const { id: photo } = await seedImage(await cameraJpeg());
    const pdfId = randomUUID();
    await db.insert(schema.assets).values({
      id: pdfId,
      ownerId,
      uploaderId: ownerId,
      storageBucket: "test-bucket",
      storageKey: `users/${ownerId}/assets/${pdfId}.pdf`,
      originalFilename: "a.pdf",
      displayName: "a.pdf",
      mimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      fileExtension: "pdf",
      sizeBytes: 10,
      kind: "pdf",
      status: "ready",
    });
    const [document] = await db
      .insert(schema.documents)
      .values({ ownerId, title: "Trip notes", markdown: `![[asset:${photo}]] ![[asset:${pdfId}]]` })
      .returning({ id: schema.documents.id });
    await db.insert(schema.documentAssets).values([
      { documentId: document.id, assetId: photo },
      { documentId: document.id, assetId: pdfId },
    ]);
    await db.insert(schema.documentPermissions).values({ documentId: document.id, userId: strangerId, role: "viewer" });

    const resolutions = await assetsServer.listAssetResolutionsForDocument(document.id, strangerId);
    expect(resolutions[photo].displayUrl).toBe(
      `/api/assets/${photo}/content?doc=${document.id}&r=display&v=${lib.RENDITION_VERSION}`,
    );
    expect(resolutions[photo].url).toBe(`/api/assets/${photo}/content?doc=${document.id}`);
    expect(resolutions[pdfId].displayUrl).toBeNull();

    // A reader of the document gets the display copy through the same grant.
    const { GET } = await import("@/app/api/assets/[assetId]/content/route");
    const fetchAs = async (userId: string | null, query: string) => {
      session.userId = userId;
      return GET(new Request(`http://vault.test/api/assets/${photo}/content?${query}`), {
        params: Promise.resolve({ assetId: photo }),
      });
    };
    const display = await fetchAs(strangerId, `doc=${document.id}&r=display&v=${lib.RENDITION_VERSION}`);
    expect(display.status).toBe(200);
    expect(display.headers.get("content-type")).toBe("image/webp");
    // Without the grant (no doc, or a reader removed), nothing.
    expect((await fetchAs(strangerId, `r=display`)).status).toBe(404);
    await db.delete(schema.documentPermissions).where(orm.eq(schema.documentPermissions.documentId, document.id));
    expect((await fetchAs(strangerId, `doc=${document.id}&r=display`)).status).toBe(404);

    await db.delete(schema.documents).where(orm.eq(schema.documents.id, document.id));
  });
});
