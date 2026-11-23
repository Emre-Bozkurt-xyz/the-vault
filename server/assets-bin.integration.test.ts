import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The asset Bin against a real Postgres (docs/26_MEDIA_LIBRARY_AND_FOLDERS_PLAN.md
 * §11). Skipped unless `TEST_DATABASE_URL` points at a migrated database; rows
 * are throwaway (two fresh users, removed afterwards, assets cascade). Storage
 * is mocked: what matters is which keys Vault asks to delete, and that the
 * database — quota above all — stays right under retries and races.
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/assets-bin
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

const storage = vi.hoisted(() => ({ deleted: [] as string[] }));

vi.mock("@/lib/storage/r2", () => ({
  deleteAssetObject: async (key: string) => {
    storage.deleted.push(key);
  },
  getR2Bucket: () => "test-bucket",
  putAssetObject: async () => undefined,
  listAssetObjects: async () => [],
}));
// `server/assets` reads the session through Auth.js; nothing here needs it.
vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl)("asset Bin (database)", () => {
  type Db = typeof import("@/db");
  type Schema = typeof import("@/db/schema");
  type Assets = typeof import("@/server/assets");
  type Orm = typeof import("drizzle-orm");

  let db: Db["db"];
  let client: Db["client"];
  let schema: Schema;
  let server: Assets;
  let orm: Orm;

  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const SIZE = 100;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    server = await import("@/server/assets");
    orm = await import("drizzle-orm");

    await db.insert(schema.users).values([
      { id: ownerId, name: "Bin test owner", storageQuotaBytes: 10_000 },
      { id: strangerId, name: "Bin test stranger", storageQuotaBytes: 10_000 },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, strangerId]));
    await client.end();
  });

  beforeEach(async () => {
    storage.deleted.length = 0;
    await db.delete(schema.assets).where(orm.inArray(schema.assets.ownerId, [ownerId, strangerId]));
    await db
      .update(schema.users)
      .set({ storageUsedBytes: 0 })
      .where(orm.inArray(schema.users.id, [ownerId, strangerId]));
  });

  /** Inserts ready assets and reserves their quota, as an upload would. */
  async function seed(count: number, owner = ownerId, extra: Partial<Schema["assets"]["$inferInsert"]> = {}) {
    const rows = Array.from({ length: count }, () => {
      const id = randomUUID();
      return {
        id,
        ownerId: owner,
        uploaderId: owner,
        storageBucket: "test-bucket",
        storageKey: `users/${owner}/assets/${id}.png`,
        originalFilename: `${id}.png`,
        displayName: `Test ${id.slice(0, 6)}.png`,
        mimeType: "image/png",
        detectedMimeType: "image/png",
        fileExtension: "png",
        sizeBytes: SIZE,
        kind: "image" as const,
        status: "ready" as const,
        ...extra,
      };
    });
    await db.insert(schema.assets).values(rows);
    await db
      .update(schema.users)
      .set({ storageUsedBytes: orm.sql`${schema.users.storageUsedBytes} + ${count * SIZE}` })
      .where(orm.eq(schema.users.id, owner));
    return rows.map((row) => row.id);
  }

  async function usedBytes(userId = ownerId) {
    const [row] = await db
      .select({ used: schema.users.storageUsedBytes })
      .from(schema.users)
      .where(orm.eq(schema.users.id, userId));
    return Number(row.used);
  }

  async function statusOf(assetId: string) {
    const [row] = await db
      .select({ status: schema.assets.status, trashedAt: schema.assets.trashedAt })
      .from(schema.assets)
      .where(orm.eq(schema.assets.id, assetId));
    return row;
  }

  it("binning hides an asset from everyone but its owner and keeps its quota", async () => {
    const [id, other] = await seed(2, ownerId, { visibility: "public" });

    const moved = await server.trashAssetsForUser({ userId: ownerId, assetIds: [id] });
    expect(moved.map((row) => row.id)).toEqual([id]);
    expect((await statusOf(id)).status).toBe("trashed");

    // Quota unchanged, and a recount agrees with the running total.
    expect(await usedBytes()).toBe(2 * SIZE);
    expect(await server.recalculateUserStorage(ownerId)).toBe(2 * SIZE);

    // Gone from the library, present in the Bin.
    const library = await server.listAssetsForUser(ownerId);
    expect(library.map((asset) => asset.id)).toEqual([other]);
    const bin = await server.listBinAssetsForUser(ownerId);
    expect(bin.map((asset) => asset.id)).toEqual([id]);
    expect(new Date(bin[0].purgeAt).getTime()).toBeGreaterThan(Date.now());

    // Owner can still preview it, never cacheable publicly; nobody else can read it.
    const ownerRead = await server.getReadableAsset({ assetId: id, userId: ownerId });
    expect(ownerRead?.visibility).toBe("private");
    expect(await server.getReadableAsset({ assetId: id, userId: strangerId })).toBeNull();
    expect(await server.getReadableAsset({ assetId: id, userId: null })).toBeNull();

    // Not in the public gallery, even though its stored visibility is public.
    const gallery = await server.listPublicAssets({ limit: 500 });
    expect(gallery.some((asset) => asset.id === id)).toBe(false);

    // The sidebar summary counts it in the Bin, not in the library.
    const summary = await server.summarizeAssetsForUser(ownerId, 5);
    expect(summary.counts.all).toBe(1);
    expect(summary.binCount).toBe(1);
  });

  it("restores exactly what was binned, and repeats are no-ops", async () => {
    const [id] = await seed(1, ownerId, { visibility: "public" });

    await server.trashAssetsForUser({ userId: ownerId, assetIds: [id] });
    expect(await server.trashAssetsForUser({ userId: ownerId, assetIds: [id] })).toEqual([]);

    const restored = await server.restoreAssetsForUser({ userId: ownerId, assetIds: [id] });
    expect(restored.map((row) => row.id)).toEqual([id]);
    expect(await server.restoreAssetsForUser({ userId: ownerId, assetIds: [id] })).toEqual([]);

    const row = await statusOf(id);
    expect(row.status).toBe("ready");
    expect(row.trashedAt).toBeNull();
    // Visibility survived the round trip.
    expect((await server.getReadableAsset({ assetId: id, userId: null }))?.id).toBe(id);
    expect(await usedBytes()).toBe(SIZE);
  });

  it("never lets someone else bin, restore, or delete your assets", async () => {
    const [id] = await seed(1);

    expect(await server.trashAssetsForUser({ userId: strangerId, assetIds: [id] })).toEqual([]);
    await server.trashAssetsForUser({ userId: ownerId, assetIds: [id] });
    expect(await server.restoreAssetsForUser({ userId: strangerId, assetIds: [id] })).toEqual([]);
    expect(
      await server.deleteAssetsForeverForUser({ userId: strangerId, assetIds: [id] }),
    ).toEqual([]);
    expect(await server.emptyAssetBinForUser(strangerId)).toEqual([]);
    expect((await statusOf(id)).status).toBe("trashed");
    expect(storage.deleted).toEqual([]);
  });

  it("deletes forever only from the Bin, freeing quota, links and bytes", async () => {
    const [id] = await seed(1);
    const [document] = await db
      .insert(schema.documents)
      .values({ ownerId, title: "Bin test doc", markdown: `![[asset:${id}]]` })
      .returning({ id: schema.documents.id });
    await db.insert(schema.documentAssets).values({ documentId: document.id, assetId: id });

    // A live asset cannot be deleted outright by its owner.
    expect(await server.deleteAssetsForeverForUser({ userId: ownerId, assetIds: [id] })).toEqual(
      [],
    );
    expect(await usedBytes()).toBe(SIZE);

    await server.trashAssetsForUser({ userId: ownerId, assetIds: [id] });
    // Binning keeps the document link, so a restore re-attaches the embed.
    const linksWhileBinned = await db
      .select()
      .from(schema.documentAssets)
      .where(orm.eq(schema.documentAssets.assetId, id));
    expect(linksWhileBinned).toHaveLength(1);

    const deleted = await server.deleteAssetsForeverForUser({ userId: ownerId, assetIds: [id] });
    expect(deleted).toEqual([{ id, sizeBytes: SIZE }]);
    expect((await statusOf(id)).status).toBe("deleted");
    expect(await usedBytes()).toBe(0);
    expect(storage.deleted).toEqual([`users/${ownerId}/assets/${id}.png`]);
    const linksAfter = await db
      .select()
      .from(schema.documentAssets)
      .where(orm.eq(schema.documentAssets.assetId, id));
    expect(linksAfter).toHaveLength(0);
    // And it cannot come back.
    expect(await server.restoreAssetsForUser({ userId: ownerId, assetIds: [id] })).toEqual([]);

    await db.delete(schema.documents).where(orm.eq(schema.documents.id, document.id));
  });

  // `db/index.ts` pools a single connection, so within one process these calls
  // interleave rather than run in parallel; what this proves is that repeated
  // and interleaved transitions never double-release. Parallel requests from
  // separate processes are covered by the same mechanism: each transition is
  // one conditional UPDATE, which Postgres serializes per row.
  it("releases quota once when deletes and a restore interleave", async () => {
    const ids = await seed(5);
    await server.trashAssetsForUser({ userId: ownerId, assetIds: ids });

    const results = await Promise.all([
      server.deleteAssetsForeverForUser({ userId: ownerId, assetIds: ids }),
      server.deleteAssetsForeverForUser({ userId: ownerId, assetIds: ids }),
      server.emptyAssetBinForUser(ownerId),
      server.restoreAssetsForUser({ userId: ownerId, assetIds: ids.slice(0, 2) }),
    ]);

    const deletedIds = results.slice(0, 3).flat().map((row) => row.id);
    // Each asset was deleted by at most one caller.
    expect(new Set(deletedIds).size).toBe(deletedIds.length);

    const rows = await Promise.all(ids.map(statusOf));
    const stillStored = rows.filter((row) => row.status === "ready" || row.status === "trashed");
    expect(rows.filter((row) => row.status === "deleted")).toHaveLength(deletedIds.length);
    // The running total equals a fresh recount: nothing double-released.
    expect(await usedBytes()).toBe(stillStored.length * SIZE);
    expect(await server.recalculateUserStorage(ownerId)).toBe(stillStored.length * SIZE);
    expect(storage.deleted).toHaveLength(deletedIds.length);
  });

  it("purges only what sat in the Bin past retention, in bounded batches", async () => {
    const [old1, old2, recent] = await seed(3);
    const [strangersOld] = await seed(1, strangerId);
    await server.trashAssetsForUser({ userId: ownerId, assetIds: [old1, old2, recent] });
    await server.trashAssetsForUser({ userId: strangerId, assetIds: [strangersOld] });

    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await db
      .update(schema.assets)
      .set({ trashedAt: daysAgo(31) })
      .where(orm.inArray(schema.assets.id, [old1, old2, strangersOld]));
    await db
      .update(schema.assets)
      .set({ trashedAt: daysAgo(5) })
      .where(orm.eq(schema.assets.id, recent));

    const { binPurgeCutoff } = await import("@/lib/asset-lifecycle");
    const cutoff = binPurgeCutoff(new Date());

    // Other users' Bins may hold expired rows too; run until nothing of ours is due.
    let purged: string[] = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const batch = await server.purgeExpiredBinAssets({ cutoff, limit: 1 });
      expect(batch.length).toBeLessThanOrEqual(1);
      purged = purged.concat(batch.map((row) => row.id));
      if (batch.length === 0) break;
    }

    expect(purged).toEqual(expect.arrayContaining([old1, old2, strangersOld]));
    expect(purged).not.toContain(recent);
    expect((await statusOf(recent)).status).toBe("trashed");
    expect(await usedBytes()).toBe(SIZE);
    expect(await usedBytes(strangerId)).toBe(0);
  });

  it("lets admin moderation delete a live asset directly", async () => {
    const [id] = await seed(1);
    await server.adminDeleteAsset(id);
    expect((await statusOf(id)).status).toBe("deleted");
    expect(await usedBytes()).toBe(0);
    await expect(server.adminDeleteAsset(id)).rejects.toThrow("Asset not found.");
  });
});
