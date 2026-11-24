import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Allowance tiers against a real Postgres (docs/03 "user_tiers"). Skipped
 * unless `TEST_DATABASE_URL` points at a migrated database. Rows are
 * throwaway (one fresh user, test-named tiers), and the deployment's default
 * tier is put back afterwards.
 *
 *   TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault npx vitest run server/user-tiers
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

vi.mock("@/auth", () => ({ auth: async () => null }));

describe.skipIf(!databaseUrl)("user tiers (database)", () => {
  type Db = typeof import("@/db");
  type Schema = typeof import("@/db/schema");
  type Tiers = typeof import("@/server/user-tiers");
  type Assets = typeof import("@/server/assets");
  type Orm = typeof import("drizzle-orm");

  let db: Db["db"];
  let client: Db["client"];
  let schema: Schema;
  let tiers: Tiers;
  let assets: Assets;
  let orm: Orm;

  const userId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const createdTiers: string[] = [];
  let originalDefault: string | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ db, client } = await import("@/db"));
    schema = await import("@/db/schema");
    tiers = await import("@/server/user-tiers");
    assets = await import("@/server/assets");
    orm = await import("drizzle-orm");

    const [current] = await db
      .select({ id: schema.userTiers.id })
      .from(schema.userTiers)
      .where(orm.eq(schema.userTiers.isDefault, true));
    originalDefault = current?.id ?? null;
    await db.insert(schema.users).values({ id: userId, name: "Tier test user" });
  });

  afterAll(async () => {
    if (!db) return;
    if (originalDefault) await tiers.setDefaultUserTier(originalDefault);
    await db.delete(schema.users).where(orm.eq(schema.users.id, userId));
    if (createdTiers.length > 0) {
      await db.delete(schema.userTiers).where(orm.inArray(schema.userTiers.id, createdTiers));
    }
    await client.end();
  });

  async function newTier(name: string, storageQuotaBytes: number, unrestrictedUploadsAllowed = false) {
    const id = await tiers.createUserTier({ name: `${name} ${suffix}`, storageQuotaBytes, unrestrictedUploadsAllowed });
    createdTiers.push(id);
    return id;
  }

  async function allowance() {
    const [row] = await db
      .select(tiers.userAllowanceColumns())
      .from(schema.users)
      .where(orm.eq(schema.users.id, userId));
    return tiers.toUserAllowance(row);
  }

  it("follows the default tier until put on another, and the quota check uses it", async () => {
    const before = await allowance();
    expect(before.tierId).toBeNull();
    const [defaultTier] = await db
      .select()
      .from(schema.userTiers)
      .where(orm.eq(schema.userTiers.isDefault, true));
    expect(before.storageQuotaBytes).toBe(Number(defaultTier.storageQuotaBytes));
    expect(before.tierName).toBe(defaultTier.name);

    const small = await newTier("Small", 1_000, true);
    await tiers.setUserTier(userId, small);
    const summary = await assets.getUserStorageSummary(userId);
    expect(summary.quotaBytes).toBe(1_000);
    expect(summary.unrestrictedUploadsAllowed).toBe(true);

    await assets.reserveUserStorage(userId, 900);
    await expect(assets.reserveUserStorage(userId, 200)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    // Editing the tier applies to its members on the next upload.
    await tiers.updateUserTier(small, { name: `Small ${suffix}`, storageQuotaBytes: 2_000, unrestrictedUploadsAllowed: true });
    await assets.reserveUserStorage(userId, 200);
    await assets.releaseUserStorage(userId, 1_100);
  });

  it("lets a user's own values win, and clearing them inherits again", async () => {
    const tier = await newTier("Override", 1_000, true);
    await tiers.setUserTier(userId, tier);

    await tiers.setUserStorageQuotaOverride(userId, 5_000);
    await tiers.setUserUnrestrictedUploadsOverride(userId, false);
    let current = await allowance();
    expect(current.storageQuotaBytes).toBe(5_000);
    expect(current.storageQuotaOverrideBytes).toBe(5_000);
    expect(current.tierStorageQuotaBytes).toBe(1_000);
    expect(current.unrestrictedUploadsAllowed).toBe(false);
    expect(current.tierUnrestrictedUploads).toBe(true);

    await tiers.setUserStorageQuotaOverride(userId, null);
    await tiers.setUserUnrestrictedUploadsOverride(userId, null);
    current = await allowance();
    expect(current.storageQuotaBytes).toBe(1_000);
    expect(current.unrestrictedUploadsAllowed).toBe(true);
  });

  it("refuses duplicate names (any case) and deleting the default tier", async () => {
    await newTier("Unique", 1_000);
    await expect(
      tiers.createUserTier({ name: `UNIQUE ${suffix}`, storageQuotaBytes: 1, unrestrictedUploadsAllowed: false }),
    ).rejects.toMatchObject({ code: "TIER_NAME_TAKEN" });

    const defaultId = (await tiers.listUserTiers()).find((tier) => tier.isDefault)!.id;
    await expect(tiers.deleteUserTier(defaultId)).rejects.toMatchObject({ code: "DEFAULT_TIER" });
  });

  it("moves members of a deleted tier to the default, and follows a new default", async () => {
    const doomed = await newTier("Doomed", 3_000);
    await tiers.setUserTier(userId, doomed);
    expect((await tiers.listUserTiers()).find((tier) => tier.id === doomed)?.memberCount).toBe(1);

    await tiers.deleteUserTier(doomed);
    let current = await allowance();
    expect(current.tierId).toBeNull();

    const next = await newTier("Next default", 7_000);
    await tiers.setDefaultUserTier(next);
    const list = await tiers.listUserTiers();
    expect(list.filter((tier) => tier.isDefault).map((tier) => tier.id)).toEqual([next]);
    current = await allowance();
    expect(current.storageQuotaBytes).toBe(7_000);
    expect(current.tierName).toBe(`Next default ${suffix}`);
  });
});
