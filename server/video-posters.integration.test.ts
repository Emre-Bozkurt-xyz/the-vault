import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-made video posters (ffmpeg) against a real Postgres, for videos the
 * uploader's browser can't decode. Skipped unless `TEST_DATABASE_URL` points
 * at a migrated database and ffmpeg/ffprobe are on PATH. The bucket is an
 * in-memory map served over a local HTTP server, standing in for the signed
 * R2 URL ffmpeg reads.
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/video-posters
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const bucket = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  puts: [] as string[],
  origin: "",
}));

vi.mock("@/lib/storage/r2", () => ({
  getR2Bucket: () => "test-bucket",
  putAssetObject: async (input: { key: string; body: Buffer }) => {
    bucket.puts.push(input.key);
    bucket.objects.set(input.key, Buffer.from(input.body));
  },
  deleteAssetObject: async (key: string) => {
    bucket.objects.delete(key);
  },
  getAssetObject: async () => {
    throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  },
  presignAssetDownloadForServer: async (key: string) => `${bucket.origin}/${encodeURIComponent(key)}?sig=test`,
  listAssetObjects: async () => [],
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl || !hasFfmpeg)("server video posters (database, ffmpeg)", () => {
  type Db = typeof import("@/db");
  let db: Db["db"];
  let client: Db["client"];
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let renditions: typeof import("@/server/asset-renditions");
  let lib: typeof import("@/lib/asset-renditions");
  let server: Server;
  let workDir: string;
  let mjpegMov: Buffer;

  const ownerId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    renditions = await import("@/server/asset-renditions");
    lib = await import("@/lib/asset-renditions");

    // A Motion-JPEG QuickTime clip, like an older digicam's: Chrome can't decode it.
    workDir = mkdtempSync(join(tmpdir(), "vault-video-"));
    const file = join(workDir, "clip.mov");
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10", "-t", "3",
      "-c:v", "mjpeg", "-q:v", "5", "-f", "mov", file,
    ]);
    mjpegMov = readFileSync(file);

    // Serves the fake bucket with byte ranges, as R2 would.
    server = createServer((request, response) => {
      const key = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname.slice(1));
      const body = bucket.objects.get(key);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        response.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
        });
        response.end(body.subarray(start, end + 1));
        return;
      }
      response.writeHead(200, { "Content-Length": body.length, "Accept-Ranges": "bytes" });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    bucket.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await db.insert(schema.users).values({ id: ownerId, name: "Video poster owner", storageQuotaOverrideBytes: 1e9 });
  });

  afterAll(async () => {
    server?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    if (!db) return;
    await db.delete(schema.users).where(orm.eq(schema.users.id, ownerId));
    await client.end();
  });

  beforeEach(async () => {
    bucket.objects.clear();
    bucket.puts.length = 0;
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    await db.delete(schema.assets).where(orm.eq(schema.assets.ownerId, ownerId));
  });

  async function seedVideo(bytes: Buffer, extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    const storageKey = `users/${ownerId}/assets/${id}.mov`;
    bucket.objects.set(storageKey, bytes);
    await db.insert(schema.assets).values({
      id,
      ownerId,
      uploaderId: ownerId,
      kind: "video",
      status: "ready",
      storageKey,
      storageBucket: "test-bucket",
      originalFilename: "100_0066.MOV",
      displayName: "100_0066.MOV",
      mimeType: "video/quicktime",
      detectedMimeType: "video/quicktime",
      fileExtension: "mov",
      sizeBytes: bytes.length,
      ...extra,
    });
    const [row] = await db
      .select({
        id: schema.assets.id,
        ownerId: schema.assets.ownerId,
        storageKey: schema.assets.storageKey,
        kind: schema.assets.kind,
        mimeType: schema.assets.mimeType,
        renditionStatus: schema.assets.renditionStatus,
        renditionVersion: schema.assets.renditionVersion,
      })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, id));
    return row;
  }

  async function stored(id: string) {
    const [row] = await db.select().from(schema.assets).where(orm.eq(schema.assets.id, id));
    return row;
  }

  it("makes a poster for a Motion-JPEG MOV, with its size and length", async () => {
    const video = await seedVideo(mjpegMov);
    await expect(renditions.ensureServerVideoPoster(video)).resolves.toBe(true);

    const row = await stored(video.id);
    expect(row.renditionStatus).toBe("ready");
    expect(row.renditionVersion).toBe(lib.RENDITION_VERSION);
    expect([row.width, row.height]).toEqual([640, 480]);
    expect(row.durationMs).toBeGreaterThan(2500);
    expect(row.durationMs).toBeLessThan(3500);
    expect(bucket.puts.filter((key) => key.includes(`/renditions/${video.id}/`))).toHaveLength(2);

    // Already has one: nothing more to do.
    await expect(renditions.ensureServerVideoPoster({ ...video, renditionStatus: "ready" })).resolves.toBe(true);
    expect(bucket.puts).toHaveLength(2);
  });

  it("marks a file ffmpeg can't read as failed, once", async () => {
    const video = await seedVideo(Buffer.from("definitely not a video"));
    await expect(renditions.ensureServerVideoPoster(video)).resolves.toBe(false);
    const row = await stored(video.id);
    expect(row.renditionStatus).toBe("failed");
    expect(row.renditionVersion).toBe(lib.RENDITION_VERSION);
    expect(bucket.puts).toHaveLength(0);
  });

  it("records nothing when ffmpeg isn't installed, so it retries later", async () => {
    process.env.FFMPEG_PATH = join(workDir, "no-such-ffmpeg");
    process.env.FFPROBE_PATH = join(workDir, "no-such-ffprobe");
    const video = await seedVideo(mjpegMov);
    await expect(renditions.ensureServerVideoPoster(video)).resolves.toBe(false);
    expect((await stored(video.id)).renditionStatus).toBe("none");
  });

  it("backfills videos without posters once they are an hour old", async () => {
    const old = await seedVideo(mjpegMov, { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    const fresh = await seedVideo(mjpegMov);
    await renditions.backfillRenditions({ limit: 10, deadline: Date.now() + 60_000 });
    expect((await stored(old.id)).renditionStatus).toBe("ready");
    expect((await stored(fresh.id)).renditionStatus).toBe("none");
  });
});
