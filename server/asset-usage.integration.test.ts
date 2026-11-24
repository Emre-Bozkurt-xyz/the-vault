import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Where files are used (the warning before binning, Details' "Used in")
 * against a real Postgres. Skipped unless `TEST_DATABASE_URL` points at a
 * migrated database; rows are throwaway (two users, cascaded away after).
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/asset-usage
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl)("asset usage (database)", () => {
  type Db = typeof import("@/db");
  let db: Db["db"];
  let client: Db["client"];
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let usage: typeof import("@/server/asset-usage");

  const ownerId = randomUUID();
  const otherId = randomUUID();
  const photo = randomUUID();
  const unused = randomUUID();
  const stickerOnly = randomUUID();
  const inFolder = randomUUID();
  const folderId = randomUUID();
  const childFolderId = randomUUID();
  const docs = { mine: "", theirs: "", binned: "" };

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    usage = await import("@/server/asset-usage");

    await db.insert(schema.users).values([
      { id: ownerId, name: "Usage owner" },
      { id: otherId, name: "Usage other" },
    ]);
    await db.insert(schema.assetFolders).values([
      { id: folderId, ownerId, name: "Trip" },
      { id: childFolderId, ownerId, name: "Day 1", parentId: folderId },
    ]);
    const asset = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      ownerId,
      uploaderId: ownerId,
      storageBucket: "test-bucket",
      storageKey: `users/${ownerId}/assets/${id}.jpg`,
      originalFilename: `${id}.jpg`,
      displayName: `${id.slice(0, 4)}.jpg`,
      mimeType: "image/jpeg",
      detectedMimeType: "image/jpeg",
      fileExtension: "jpg",
      sizeBytes: 10,
      kind: "image" as const,
      status: "ready" as const,
      ...extra,
    });
    await db.insert(schema.assets).values([
      asset(photo, { displayName: "harbour.jpg" }),
      asset(unused),
      asset(stickerOnly, { displayName: "cat-sticker.png" }),
      asset(inFolder, { folderId: childFolderId, displayName: "deep.jpg" }),
    ]);

    const [mine] = await db
      .insert(schema.documents)
      .values({ ownerId, title: "Trip notes", markdown: `# Trip\n\nIntro\n![[asset:${photo}|Harbour]]\n![[asset:${inFolder}]]` })
      .returning({ id: schema.documents.id });
    const [theirs] = await db
      .insert(schema.documents)
      .values({ ownerId: otherId, title: "Private diary", markdown: `![[asset:${photo}]]` })
      .returning({ id: schema.documents.id });
    const [binned] = await db
      .insert(schema.documents)
      .values({ ownerId, title: "Old draft", markdown: `![[asset:${photo}]]`, deletedAt: new Date() })
      .returning({ id: schema.documents.id });
    Object.assign(docs, { mine: mine.id, theirs: theirs.id, binned: binned.id });
    // Stickers keep their files in extension state, not the text.
    const stickers = (...ids: string[]) => ({
      items: Object.fromEntries(ids.map((id, index) => [`s${index}`, { assetId: id, left: 10, top: 10, width: 120, rotation: 0 }])),
    });
    await db.insert(schema.documentExtensionStates).values([
      { documentId: mine.id, extensionId: "vault.stickers", stateKey: "layout", state: stickers(photo, stickerOnly) },
      // A removed state row doesn't count.
      { documentId: theirs.id, extensionId: "vault.stickers", stateKey: "layout", state: stickers(unused), deletedAt: new Date() },
    ]);
    await db.insert(schema.documentAssets).values([
      { documentId: mine.id, assetId: photo },
      { documentId: mine.id, assetId: inFolder },
      { documentId: theirs.id, assetId: photo },
      { documentId: binned.id, assetId: photo },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.documents).where(orm.inArray(schema.documents.ownerId, [ownerId, otherId]));
    await db.delete(schema.users).where(orm.inArray(schema.users.id, [ownerId, otherId]));
    await client.end();
  });

  it("names documents the owner can open, with the embed's line, and counts the rest", async () => {
    const [entry] = await usage.getAssetUsageForOwner(ownerId, { assetIds: [photo] });
    expect(entry.name).toBe("harbour.jpg");
    expect(entry.documents).toEqual([
      { id: docs.mine, title: "Trip notes", line: 3, text: `![[asset:${photo}|Harbour]]`, via: null, reveal: null },
      // The same document again, through the Stickers extension: no line, but
      // the sticker to reveal.
      {
        id: docs.mine,
        title: "Trip notes",
        line: null,
        text: null,
        via: "Stickers",
        reveal: { extensionId: "vault.stickers", locator: "s0" },
      },
    ]);
    // Someone else's private document: counted, not named. A binned document: skipped.
    expect(entry.hidden).toBe(1);
  });

  it("finds files used only through extension state, by the extension's own declaration", async () => {
    const [entry] = await usage.getAssetUsageForOwner(ownerId, { assetIds: [stickerOnly] });
    expect(entry).toMatchObject({ assetId: stickerOnly, name: "cat-sticker.png", hidden: 0 });
    expect(entry.documents).toEqual([
      {
        id: docs.mine,
        title: "Trip notes",
        line: null,
        text: null,
        via: "Stickers",
        reveal: { extensionId: "vault.stickers", locator: "s1" },
      },
    ]);
  });

  it("returns nothing for unused files or other people's files", async () => {
    expect(await usage.getAssetUsageForOwner(ownerId, { assetIds: [unused] })).toEqual([]);
    expect(await usage.getAssetUsageForOwner(otherId, { assetIds: [photo] })).toEqual([]);
  });

  it("looks inside folders, all the way down", async () => {
    const result = await usage.getAssetUsageForOwner(ownerId, { folderIds: [folderId] });
    expect(result.map((entry) => entry.name)).toEqual(["deep.jpg"]);
    expect(result[0].documents[0]).toMatchObject({ id: docs.mine, line: 4 });
  });
});
