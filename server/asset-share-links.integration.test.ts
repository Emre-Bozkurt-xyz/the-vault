import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Media share links against a real Postgres (docs/26 §9, §11): tokens, every
 * reason a link stops working, the subtree boundary, the downloads rule in the
 * content route, and the zip. Skipped unless `TEST_DATABASE_URL` is set; rows
 * are throwaway. Storage is an in-memory map.
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/asset-share-links
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

const bucket = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("@/lib/storage/r2", () => ({
  getR2Bucket: () => "test-bucket",
  putAssetObject: async (input: { key: string; body: Buffer }) => {
    bucket.objects.set(input.key, Buffer.from(input.body));
  },
  deleteAssetObject: async (key: string) => {
    bucket.objects.delete(key);
  },
  getAssetObject: async (key: string) => {
    const body = bucket.objects.get(key);
    if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    return {
      ContentLength: body.byteLength,
      Body: {
        transformToByteArray: async () => new Uint8Array(body),
        transformToWebStream: () => new Blob([new Uint8Array(body)]).stream(),
      },
    };
  },
  listAssetObjects: async () => [],
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl)("asset share links (database)", () => {
  type Db = typeof import("@/db");
  let db: Db["db"];
  let client: Db["client"];
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let shares: typeof import("@/server/asset-share-links");
  let folders: typeof import("@/server/asset-folders");
  let assetsServer: typeof import("@/server/assets");
  let tokens: typeof import("@/lib/share-token");

  const ownerId = randomUUID();
  const strangerId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET ??= "share-link-test-secret-0123456789abcdef";
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    shares = await import("@/server/asset-share-links");
    folders = await import("@/server/asset-folders");
    assetsServer = await import("@/server/assets");
    tokens = await import("@/lib/share-token");
    await db.insert(schema.users).values([
      { id: ownerId, name: "Share owner", storageQuotaBytes: 1e9 },
      { id: strangerId, name: "Share stranger", storageQuotaBytes: 1e9 },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, strangerId]));
    await client.end();
  });

  beforeEach(async () => {
    bucket.objects.clear();
    for (const userId of [ownerId, strangerId]) {
      await db.delete(schema.assetShareLinks).where(orm.eq(schema.assetShareLinks.ownerId, userId));
      await db.delete(schema.assets).where(orm.eq(schema.assets.ownerId, userId));
      await db.delete(schema.assetFolders).where(orm.eq(schema.assetFolders.ownerId, userId));
    }
    await db.update(schema.users).set({ bannedAt: null, bannedUntil: null }).where(orm.eq(schema.users.id, ownerId));
  });

  const mkdir = (name: string, parentId: string | null = null, userId = ownerId) =>
    folders.createAssetFolder({ userId, name, parentId });

  async function seed(folderId: string | null, extra: Record<string, unknown> = {}, owner = ownerId) {
    const id = randomUUID();
    const kind = (extra.kind as string) ?? "pdf";
    const storageKey = `users/${owner}/assets/${id}.bin`;
    bucket.objects.set(storageKey, Buffer.from(`bytes of ${id}`));
    await db.insert(schema.assets).values({
      id,
      ownerId: owner,
      uploaderId: owner,
      storageBucket: "test-bucket",
      storageKey,
      originalFilename: `${id}.bin`,
      displayName: (extra.displayName as string) ?? `File ${id.slice(0, 4)}.pdf`,
      mimeType: kind === "video" ? "video/mp4" : "application/pdf",
      detectedMimeType: kind === "video" ? "video/mp4" : "application/pdf",
      fileExtension: kind === "video" ? "mp4" : "pdf",
      sizeBytes: Buffer.byteLength(`bytes of ${id}`),
      kind: kind as "pdf",
      status: "ready",
      folderId,
      ...extra,
    });
    return id;
  }

  async function share(target: { folderId: string } | { assetId: string }, allowDownload = true, expiresInDays: number | null = null) {
    const link = await shares.upsertShareLink({ userId: ownerId, target, allowDownload, expiresInDays });
    return { link, token: link.path.slice("/s/".length) };
  }

  async function content(assetId: string, query: string) {
    const { GET } = await import("@/app/api/assets/[assetId]/content/route");
    return GET(new Request(`http://vault.test/api/assets/${assetId}/content?${query}`), {
      params: Promise.resolve({ assetId }),
    });
  }

  it("resolves only genuine, live links", async () => {
    const events = await mkdir("Events");
    const { token } = await share({ folderId: events.id });

    const resolved = await shares.resolveShareToken(token);
    expect(resolved?.folder).toEqual({ id: events.id, name: "Events" });
    expect(resolved?.ownerName).toBe("Share owner");

    // Forged: right shape, wrong signature; and an unknown id signed correctly.
    expect(await shares.resolveShareToken(token.slice(0, 22) + "A".repeat(22))).toBeNull();
    expect(await shares.resolveShareToken(tokens.encodeShareToken(randomUUID(), process.env.AUTH_SECRET!))).toBeNull();
  });

  it("keeps one link per target: settings change in place, reset swaps the URL", async () => {
    const album = await mkdir("Album");
    const first = await share({ folderId: album.id }, true);
    const again = await share({ folderId: album.id }, false, 7);
    expect(again.link.id).toBe(first.link.id);
    expect(again.token).toBe(first.token);
    expect(again.link.allowDownload).toBe(false);
    expect(again.link.expiresAt).not.toBeNull();

    const fresh = await shares.resetShareLink(ownerId, first.link.id);
    expect(fresh.id).not.toBe(first.link.id);
    expect(await shares.resolveShareToken(first.token)).toBeNull();
    expect(await shares.resolveShareToken(fresh.path.slice(3))).not.toBeNull();

    // Concurrent turn-ons can't create two live links for one target.
    const other = await mkdir("Other");
    await Promise.all([share({ folderId: other.id }), share({ folderId: other.id }), share({ folderId: other.id })]);
    const live = await db
      .select()
      .from(schema.assetShareLinks)
      .where(orm.and(orm.eq(schema.assetShareLinks.folderId, other.id), orm.isNull(schema.assetShareLinks.revokedAt)));
    expect(live).toHaveLength(1);
  });

  it("stops working when revoked, expired, binned (resumes on restore), or the owner is banned", async () => {
    const trip = await mkdir("Trip");
    const { link, token } = await share({ folderId: trip.id });

    await folders.trashAssetFolder({ userId: ownerId, folderId: trip.id });
    expect(await shares.resolveShareToken(token)).toBeNull();
    await folders.restoreAssetFolder({ userId: ownerId, folderId: trip.id });
    expect(await shares.resolveShareToken(token)).not.toBeNull();

    await db.update(schema.users).set({ bannedAt: new Date() }).where(orm.eq(schema.users.id, ownerId));
    expect(await shares.resolveShareToken(token)).toBeNull();
    await db.update(schema.users).set({ bannedAt: null }).where(orm.eq(schema.users.id, ownerId));

    await db
      .update(schema.assetShareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(schema.assetShareLinks.id, link.id));
    expect(await shares.resolveShareToken(token)).toBeNull();
    expect((await shares.getShareLinkForTarget(ownerId, { folderId: trip.id }))?.expired).toBe(true);

    await shares.upsertShareLink({ userId: ownerId, target: { folderId: trip.id }, allowDownload: true, expiresInDays: null });
    expect(await shares.resolveShareToken(token)).not.toBeNull();
    await shares.revokeShareLink(ownerId, link.id);
    expect(await shares.resolveShareToken(token)).toBeNull();
  });

  it("counts what the Shared place lists: live linked folders and files, and public files, once each", async () => {
    expect(await shares.countSharedForUser(ownerId)).toBe(0);
    const album = await mkdir("Album");
    const linked = await seed(null);
    const publicFile = await seed(null, { visibility: "public" });
    await seed(null); // private, unshared
    await share({ folderId: album.id });
    await share({ assetId: linked });
    await share({ assetId: publicFile }); // linked and public: still one item
    expect(await shares.countSharedForUser(ownerId)).toBe(3);

    // A revoked link, a binned folder and another user's items don't count.
    const revoked = await seed(null);
    const { link } = await share({ assetId: revoked });
    await shares.revokeShareLink(ownerId, link.id);
    await folders.trashAssetFolder({ userId: ownerId, folderId: album.id });
    await seed(null, { visibility: "public" }, strangerId);
    expect(await shares.countSharedForUser(ownerId)).toBe(2);
  });

  it("only owners can share, and only live things", async () => {
    const mine = await mkdir("Mine");
    await expect(
      shares.upsertShareLink({ userId: strangerId, target: { folderId: mine.id }, allowDownload: true, expiresInDays: null }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      shares.upsertShareLink({ userId: ownerId, target: { folderId: mine.id }, allowDownload: true, expiresInDays: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    const binned = await seed(null);
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [binned] });
    await expect(
      shares.upsertShareLink({ userId: ownerId, target: { assetId: binned }, allowDownload: true, expiresInDays: null }),
    ).rejects.toMatchObject({ status: 404 });
    const { link } = await share({ folderId: mine.id });
    await expect(shares.revokeShareLink(strangerId, link.id)).rejects.toMatchObject({ status: 404 });
  });

  it("reaches the shared subtree and nothing outside it", async () => {
    const parent = await mkdir("Parent");
    const shared = await mkdir("Shared", parent.id);
    const inner = await mkdir("Inner", shared.id);
    const sibling = await mkdir("Sibling", parent.id);
    const inShared = await seed(shared.id, { takenAt: new Date("2026-10-01T10:00:00Z") });
    const inInner = await seed(inner.id);
    const inSibling = await seed(sibling.id);
    const inParent = await seed(parent.id);
    const strangers = await seed(null, {}, strangerId);
    const { token } = await share({ folderId: shared.id });
    const resolved = (await shares.resolveShareToken(token))!;

    for (const id of [inShared, inInner]) expect(await shares.getAssetViaShare(resolved, id)).not.toBeNull();
    for (const id of [inSibling, inParent, strangers]) expect(await shares.getAssetViaShare(resolved, id)).toBeNull();

    expect(await shares.isFolderInShare(resolved, inner.id)).toBe(true);
    expect(await shares.isFolderInShare(resolved, parent.id)).toBe(false);
    expect(await shares.isFolderInShare(resolved, sibling.id)).toBe(false);
    expect(await shares.listSharedFolder(resolved, token, parent.id)).toBeNull();

    // The path never climbs above the shared folder.
    const listing = (await shares.listSharedFolder(resolved, token, inner.id))!;
    expect(listing.path.map((crumb) => crumb.name)).toEqual(["Shared", "Inner"]);
    const top = (await shares.listSharedFolder(resolved, token, shared.id))!;
    expect(top.folders).toMatchObject([{ name: "Inner", files: 1, folders: 0 }]);
    expect(top.assets.map((asset) => asset.id)).toEqual([inShared]);
    expect(top.assets[0].url).toContain(`s=${token}`);
    expect(top.assets[0]).not.toHaveProperty("renditionStatus");

    // A binned file drops out immediately.
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [inInner] });
    expect(await shares.getAssetViaShare(resolved, inInner)).toBeNull();

    // A single-file link reaches that file only.
    const file = await share({ assetId: inShared });
    const fileShare = (await shares.resolveShareToken(file.token))!;
    expect(fileShare.folder).toBeNull();
    expect(await shares.getAssetViaShare(fileShare, inShared)).not.toBeNull();
    expect(await shares.getAssetViaShare(fileShare, inSibling)).toBeNull();
  });

  it("serves originals through the content route only as the link allows", async () => {
    const album = await mkdir("Album");
    const pdf = await seed(album.id);
    const video = await seed(album.id, { kind: "video", displayName: "clip.mp4" });
    const outside = await seed(null);
    const viewOnly = await share({ folderId: album.id }, false);

    const original = await content(pdf, `s=${viewOnly.token}`);
    expect(original.status).toBe(404);
    // A video streams for playback, but can't be fetched as a download.
    const stream = await content(video, `s=${viewOnly.token}`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("cache-control")).toBe("private, no-store");
    expect((await content(video, `s=${viewOnly.token}&download=1`)).status).toBe(404);
    expect((await content(outside, `s=${viewOnly.token}`)).status).toBe(404);
    // A token isn't a session: no token, no access to a private file.
    expect((await content(pdf, "")).status).toBe(404);

    await share({ folderId: album.id }, true);
    const allowed = await content(pdf, `s=${viewOnly.token}&download=1`);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await allowed.arrayBuffer()).toString()).toBe(`bytes of ${pdf}`);
  });

  it("zips a shared folder with its subfolders, and only with downloads on", async () => {
    const event = await mkdir("Event");
    const day = await mkdir("Day 1", event.id);
    const a = await seed(event.id, { displayName: "a.pdf" });
    const b = await seed(day.id, { displayName: "b.pdf" });
    await seed(null, { displayName: "outside.pdf" });
    const { GET } = await import("@/app/s/[token]/zip/route");
    const zip = (token: string) =>
      GET(new Request(`http://vault.test/s/${token}/zip`), { params: Promise.resolve({ token }) });

    const viewOnly = await share({ folderId: event.id }, false);
    expect((await zip(viewOnly.token)).status).toBe(404);

    await share({ folderId: event.id }, true);
    const response = await zip(viewOnly.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("latin1");
    expect(text.startsWith("PK\u0003\u0004")).toBe(true);
    expect(text).toContain("a.pdf");
    expect(text).toContain("Day 1/b.pdf");
    expect(text).not.toContain("outside.pdf");
    expect(text).toContain(`bytes of ${a}`);
    expect(text).toContain(`bytes of ${b}`);
    // Two local file headers, one per file.
    expect(text.split("PK\u0003\u0004").length - 1).toBe(2);
  });

  it("removes a folder's links when the folder is deleted for good", async () => {
    const gone = await mkdir("Gone");
    const { token } = await share({ folderId: gone.id });
    await folders.trashAssetFolder({ userId: ownerId, folderId: gone.id });
    await folders.deleteAssetFolderForever({ userId: ownerId, folderId: gone.id });
    expect(await shares.resolveShareToken(token)).toBeNull();
    const rows = await db.select().from(schema.assetShareLinks).where(orm.eq(schema.assetShareLinks.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });
});
