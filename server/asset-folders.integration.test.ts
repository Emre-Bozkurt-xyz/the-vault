import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Media folders against a real Postgres (docs/26 §4.2, §11): names, moves,
 * binning a folder with its subtree, exact restores, deleting for good, the
 * purge, uploads finishing into a binned folder, and ownership. Skipped unless
 * `TEST_DATABASE_URL` points at a migrated database; rows are throwaway.
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/asset-folders
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

const storage = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/storage/r2", () => ({
  deleteAssetObject: async (key: string) => {
    storage.deleted.push(key);
  },
  getR2Bucket: () => "test-bucket",
  putAssetObject: async () => undefined,
  getAssetObject: async () => {
    throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  },
  listAssetObjects: async () => [],
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl)("asset folders (database)", () => {
  type Db = typeof import("@/db");
  let db: Db["db"];
  let client: Db["client"];
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let folders: typeof import("@/server/asset-folders");
  let assetsServer: typeof import("@/server/assets");

  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const SIZE = 100;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    folders = await import("@/server/asset-folders");
    assetsServer = await import("@/server/assets");

    await db.insert(schema.users).values([
      { id: ownerId, name: "Folder test owner", storageQuotaOverrideBytes: 1e9 },
      { id: strangerId, name: "Folder test stranger", storageQuotaOverrideBytes: 1e9 },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, strangerId]));
    await client.end();
  });

  beforeEach(async () => {
    storage.deleted.length = 0;
    for (const userId of [ownerId, strangerId]) {
      await db.delete(schema.assets).where(orm.eq(schema.assets.ownerId, userId));
      await db.delete(schema.assetFolders).where(orm.eq(schema.assetFolders.ownerId, userId));
      await db.update(schema.users).set({ storageUsedBytes: 0 }).where(orm.eq(schema.users.id, userId));
    }
  });

  const mkdir = (name: string, parentId: string | null = null, userId = ownerId) =>
    folders.createAssetFolder({ userId, name, parentId });

  async function seedAsset(folderId: string | null, extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    await db.insert(schema.assets).values({
      id,
      ownerId,
      uploaderId: ownerId,
      storageBucket: "test-bucket",
      storageKey: `users/${ownerId}/assets/${id}.png`,
      originalFilename: "a.png",
      displayName: `A ${id.slice(0, 4)}.png`,
      mimeType: "image/png",
      detectedMimeType: "image/png",
      fileExtension: "png",
      sizeBytes: SIZE,
      kind: "image",
      status: "ready",
      folderId,
      ...extra,
    });
    await db
      .update(schema.users)
      .set({ storageUsedBytes: orm.sql`${schema.users.storageUsedBytes} + ${SIZE}` })
      .where(orm.eq(schema.users.id, ownerId));
    return id;
  }

  async function assetRow(id: string) {
    const [row] = await db
      .select({
        status: schema.assets.status,
        folderId: schema.assets.folderId,
        via: schema.assets.trashedViaFolderId,
      })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, id));
    return row;
  }

  async function folderRow(id: string) {
    const [row] = await db
      .select({
        status: schema.assetFolders.status,
        parentId: schema.assetFolders.parentId,
        name: schema.assetFolders.name,
        via: schema.assetFolders.trashedViaFolderId,
      })
      .from(schema.assetFolders)
      .where(orm.eq(schema.assetFolders.id, id));
    return row;
  }

  async function usedBytes() {
    const [row] = await db
      .select({ used: schema.users.storageUsedBytes })
      .from(schema.users)
      .where(orm.eq(schema.users.id, ownerId));
    return Number(row.used);
  }

  it("keeps live sibling names unique, case-insensitively, and renames on request", async () => {
    const events = await mkdir("Events");
    await expect(mkdir("events")).rejects.toMatchObject({ status: 409 });
    // Same name is fine under a different parent.
    await mkdir("Events", events.id);

    const renamed = await folders.createAssetFolder({
      userId: ownerId,
      name: "EVENTS",
      parentId: null,
      onConflict: "rename",
    });
    expect(renamed.name).toBe("EVENTS (2)");

    await expect(
      folders.renameAssetFolder({ userId: ownerId, folderId: renamed.id, name: "events" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(mkdir("  ")).rejects.toMatchObject({ status: 400 });
  });

  it("serializes concurrent creates so only one sibling gets the name", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => mkdir("Race")),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.status === "rejected" && (result.reason as { status?: number }).status === 409,
      ),
    ).toHaveLength(4);
  });

  it("moves assets and folders, refusing cycles all-or-nothing", async () => {
    const a = await mkdir("A");
    const b = await mkdir("B", a.id);
    const c = await mkdir("C");
    const photo = await seedAsset(null);

    const moved = await folders.moveAssetItems({
      userId: ownerId,
      assetIds: [photo],
      folderIds: [c.id],
      targetFolderId: b.id,
    });
    expect(moved).toEqual({ folders: [c.id], assets: [photo] });
    expect((await assetRow(photo)).folderId).toBe(b.id);
    expect((await folderRow(c.id)).parentId).toBe(b.id);

    // A into its own grandchild C: refused, and the asset in the same request
    // does not move either.
    await expect(
      folders.moveAssetItems({ userId: ownerId, assetIds: [photo], folderIds: [a.id], targetFolderId: c.id }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await assetRow(photo)).folderId).toBe(b.id);
    expect((await folderRow(a.id)).parentId).toBeNull();

    // Back to the root; a repeat is a no-op.
    await folders.moveAssetItems({ userId: ownerId, assetIds: [photo], folderIds: [], targetFolderId: null });
    expect((await assetRow(photo)).folderId).toBeNull();
    expect(
      await folders.moveAssetItems({ userId: ownerId, assetIds: [photo], folderIds: [], targetFolderId: null }),
    ).toEqual({ folders: [], assets: [] });
  });

  it("never touches someone else's folders or assets", async () => {
    const mine = await mkdir("Mine");
    const theirs = await mkdir("Theirs", null, strangerId);
    const photo = await seedAsset(null);

    await expect(
      folders.moveAssetItems({ userId: ownerId, assetIds: [photo], folderIds: [], targetFolderId: theirs.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      folders.moveAssetItems({ userId: strangerId, assetIds: [photo], folderIds: [], targetFolderId: null }),
    ).resolves.toEqual({ folders: [], assets: [] });
    await expect(folders.trashAssetFolder({ userId: strangerId, folderId: mine.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(folders.requireLiveFolder(strangerId, mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(mkdir("Inside", mine.id, strangerId)).rejects.toMatchObject({ status: 404 });
  });

  it("bins a folder with its live subtree and restores exactly that", async () => {
    const events = await mkdir("Events");
    const lisbon = await mkdir("Lisbon", events.id);
    const porto = await mkdir("Porto", events.id);
    const inLisbon = await seedAsset(lisbon.id);
    const inEvents = await seedAsset(events.id);
    const binnedEarlier = await seedAsset(lisbon.id);
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [binnedEarlier] });
    await folders.trashAssetFolder({ userId: ownerId, folderId: porto.id });

    const result = await folders.trashAssetFolder({ userId: ownerId, folderId: events.id });
    expect(result).toMatchObject({ folders: 2, assets: 2 });

    // Everything inside is binned with Events as its marker; nothing stays live.
    expect(await assetRow(inLisbon)).toMatchObject({ status: "trashed", via: events.id });
    expect(await folderRow(lisbon.id)).toMatchObject({ status: "trashed", via: events.id });
    // Earlier Bin entries keep their own entries.
    expect(await assetRow(binnedEarlier)).toMatchObject({ status: "trashed", via: null });
    expect(await folderRow(porto.id)).toMatchObject({ status: "trashed", via: null });
    expect(await assetsServer.listAssetsForUser(ownerId)).toEqual([]);
    expect((await folders.listFoldersForUser(ownerId)).map((folder) => folder.name)).toEqual([]);
    // Quota unchanged by binning.
    expect(await usedBytes()).toBe(3 * SIZE);

    // The Bin shows Events, Porto and the earlier asset — not Events' contents.
    const binFolders = await folders.listBinFoldersForUser(ownerId);
    expect(binFolders.map((folder) => folder.name).sort()).toEqual(["Events", "Porto"]);
    expect(binFolders.find((folder) => folder.name === "Events")).toMatchObject({
      assetCount: 2,
      folderCount: 1,
      sizeBytes: 2 * SIZE,
    });
    expect((await assetsServer.listBinAssetsForUser(ownerId)).map((asset) => asset.id)).toEqual([binnedEarlier]);
    // A member of a binned folder can't be restored on its own.
    expect(await assetsServer.restoreAssetsForUser({ userId: ownerId, assetIds: [inLisbon] })).toEqual([]);

    await folders.restoreAssetFolder({ userId: ownerId, folderId: events.id });
    expect(await assetRow(inLisbon)).toMatchObject({ status: "ready", via: null, folderId: lisbon.id });
    expect(await assetRow(inEvents)).toMatchObject({ status: "ready", folderId: events.id });
    expect(await folderRow(lisbon.id)).toMatchObject({ status: "active", via: null });
    // Not restored: things binned separately.
    expect((await assetRow(binnedEarlier)).status).toBe("trashed");
    expect((await folderRow(porto.id)).status).toBe("trashed");
  });

  it("restores to the root when the old place is gone, and dodges reused names", async () => {
    const parent = await mkdir("Parent");
    const child = await mkdir("Child", parent.id);
    const photo = await seedAsset(parent.id);
    await folders.trashAssetFolder({ userId: ownerId, folderId: child.id });
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [photo] });
    await folders.trashAssetFolder({ userId: ownerId, folderId: parent.id });
    await mkdir("child");

    // Child's parent is binned: it comes back at the root, renamed.
    const restored = await folders.restoreAssetFolder({ userId: ownerId, folderId: child.id });
    expect(restored).toMatchObject({ parentId: null, name: "Child (2)" });

    // Same for an asset whose folder is binned.
    await assetsServer.restoreAssetsForUser({ userId: ownerId, assetIds: [photo] });
    expect(await assetRow(photo)).toMatchObject({ status: "ready", folderId: null });
  });

  it("restores a binned asset into its folder while that folder is live", async () => {
    const album = await mkdir("Album");
    const photo = await seedAsset(album.id);
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [photo] });
    await assetsServer.restoreAssetsForUser({ userId: ownerId, assetIds: [photo] });
    expect(await assetRow(photo)).toMatchObject({ status: "ready", folderId: album.id });
  });

  it("lands an upload finishing into a binned folder at the root", async () => {
    const target = await mkdir("Target");
    const uploading = await seedAsset(target.id, { status: "pending" });
    await folders.trashAssetFolder({ userId: ownerId, folderId: target.id });
    // A pending upload is not binned with the folder…
    expect((await assetRow(uploading)).status).toBe("pending");

    // …and the ready transition (what upload completion runs) moves it out.
    await db
      .update(schema.assets)
      .set({ status: "ready", folderId: assetsServer.liveFolderOrRoot })
      .where(orm.eq(schema.assets.id, uploading));
    expect(await assetRow(uploading)).toMatchObject({ status: "ready", folderId: null });
  });

  it("deletes a binned folder for good with its contents, keeping separate Bin entries", async () => {
    const trip = await mkdir("Trip");
    const sub = await mkdir("Sub", trip.id);
    const inside = await seedAsset(sub.id);
    const separate = await mkdir("Separate", trip.id);
    await folders.trashAssetFolder({ userId: ownerId, folderId: separate.id });
    await folders.trashAssetFolder({ userId: ownerId, folderId: trip.id });

    // Only Bin entries can be deleted forever.
    await expect(folders.deleteAssetFolderForever({ userId: ownerId, folderId: sub.id })).rejects.toMatchObject({
      status: 404,
    });

    const result = await folders.deleteAssetFolderForever({ userId: ownerId, folderId: trip.id });
    expect(result.deletedAssets).toBe(1);
    expect(await assetRow(inside)).toMatchObject({ status: "deleted" });
    expect(await folderRow(trip.id)).toBeUndefined();
    expect(await folderRow(sub.id)).toBeUndefined();
    expect(await usedBytes()).toBe(0);
    expect(storage.deleted).toEqual([`users/${ownerId}/assets/${inside}.png`]);
    // The separately binned folder survives, moved to the root.
    expect(await folderRow(separate.id)).toMatchObject({ status: "trashed", parentId: null, via: null });
  });

  it("empties the Bin of folders and assets, and the purge removes expired folders", async () => {
    const old = await mkdir("Old");
    await seedAsset(old.id);
    await folders.trashAssetFolder({ userId: ownerId, folderId: old.id });
    const daysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.update(schema.assetFolders).set({ trashedAt: daysAgo }).where(orm.eq(schema.assetFolders.id, old.id));
    await db.update(schema.assets).set({ trashedAt: daysAgo }).where(orm.eq(schema.assets.trashedViaFolderId, old.id));

    const { binPurgeCutoff } = await import("@/lib/asset-lifecycle");
    const cutoff = binPurgeCutoff(new Date());
    for (let i = 0; i < 50; i += 1) {
      if ((await assetsServer.purgeExpiredBinAssets({ cutoff, limit: 200 })).length < 200) break;
    }
    await folders.purgeExpiredBinFolders(cutoff);
    expect(await folderRow(old.id)).toBeUndefined();
    expect(await usedBytes()).toBe(0);

    const fresh = await mkdir("Fresh");
    await seedAsset(fresh.id);
    const loose = await seedAsset(null);
    await assetsServer.trashAssetsForUser({ userId: ownerId, assetIds: [loose] });
    await folders.trashAssetFolder({ userId: ownerId, folderId: fresh.id });

    const summary = await assetsServer.summarizeAssetsForUser(ownerId, 5);
    expect(summary.binCount).toBe(2);

    const emptied = await folders.emptyMediaBinForUser(ownerId);
    expect(emptied.deletedAssets).toHaveLength(2);
    expect(emptied.deletedFolders).toBe(1);
    expect(await folders.listBinFoldersForUser(ownerId)).toEqual([]);
    expect(await usedBytes()).toBe(0);
  });
});
