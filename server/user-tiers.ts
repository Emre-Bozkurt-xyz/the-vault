import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { userTiers, users } from "@/db/schema";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";

/**
 * Allowance tiers (docs/03 "user_tiers"): how much storage a user gets and
 * whether they may upload any file type. A user's effective value is their
 * own override, else their tier's, else the default tier's; `tier_id` null
 * means "follow the default tier". Role (`users.role`) is separate: it is
 * what someone may do, the tier is how much they get.
 *
 * Data access only: these functions trust their arguments. Admin checks live
 * in the actions (`server/user-tiers-admin.ts`); never add "use server" here.
 */

export class TierError extends Error {
  constructor(
    message: string,
    readonly code: "TIER_NOT_FOUND" | "TIER_NAME_TAKEN" | "DEFAULT_TIER" | "USER_NOT_FOUND",
  ) {
    super(message);
    this.name = "TierError";
  }
}

// ── Effective values, as SQL over a `users` row ─────────────────────────────

// Column references are written out with their table: inside a subquery an
// unqualified name binds to the nearest table that has it, which is not
// always the outer row. These expressions need `users` (unaliased) in scope.

/** The tier a `users` row follows: its own, else the default. */
const followedTierId = sql`coalesce("users"."tier_id", (select d.id from user_tiers d where d.is_default))`;

function followedTier(column: "name" | "storage_quota_bytes" | "unrestricted_uploads_allowed") {
  return sql`(select t.${sql.raw(column)} from user_tiers t where t.id = ${followedTierId})`;
}

/**
 * Effective storage quota in bytes. Usable anywhere `users` is in scope,
 * including the `reserveUserStorage` update, so a tier change applies to the
 * very next upload. With no default tier at all, `ASSET_LIMITS` decides.
 */
export function effectiveStorageQuotaSql() {
  return sql<number>`coalesce("users"."storage_quota_override_bytes", ${followedTier("storage_quota_bytes")}, ${sql.raw(String(ASSET_LIMITS.defaultUserStorageQuotaBytes))})`.mapWith(
    Number,
  );
}

/** Effective "upload any file type" grant. */
export function effectiveUnrestrictedUploadsSql() {
  return sql<boolean>`coalesce("users"."unrestricted_uploads_override", ${followedTier("unrestricted_uploads_allowed")}, false)`.mapWith(
    (value: unknown) => value === true || value === "t" || value === "true",
  );
}

/**
 * Everything the admin needs to show where a user's allowances come from.
 * Select these alongside `users` (also fine with `groupBy(users.id)`).
 */
export function userAllowanceColumns() {
  return {
    tierId: users.tierId,
    tierName: sql<string | null>`${followedTier("name")}`,
    tierStorageQuotaBytes: sql<number | null>`${followedTier("storage_quota_bytes")}`.mapWith(
      (value: unknown) => (value === null || value === undefined ? null : Number(value)),
    ),
    tierUnrestrictedUploads: sql<boolean>`coalesce(${followedTier("unrestricted_uploads_allowed")}, false)`.mapWith(
      (value: unknown) => value === true || value === "t" || value === "true",
    ),
    storageQuotaOverrideBytes: users.storageQuotaOverrideBytes,
    unrestrictedUploadsOverride: users.unrestrictedUploadsOverride,
    storageQuotaBytes: effectiveStorageQuotaSql(),
    unrestrictedUploadsAllowed: effectiveUnrestrictedUploadsSql(),
  };
}

export type UserAllowance = {
  /** The tier set on the user; null follows the default tier. */
  tierId: string | null;
  /** The tier actually followed (theirs or the default). */
  tierName: string | null;
  tierStorageQuotaBytes: number | null;
  tierUnrestrictedUploads: boolean;
  storageQuotaOverrideBytes: number | null;
  unrestrictedUploadsOverride: boolean | null;
  /** Effective values. */
  storageQuotaBytes: number;
  unrestrictedUploadsAllowed: boolean;
};

/** Normalises a selected {@link userAllowanceColumns} row (bigints arrive as strings). */
export function toUserAllowance(row: UserAllowance): UserAllowance {
  return {
    ...row,
    storageQuotaOverrideBytes:
      row.storageQuotaOverrideBytes === null ? null : Number(row.storageQuotaOverrideBytes),
    storageQuotaBytes: Number(row.storageQuotaBytes),
  };
}

// ── Tiers ───────────────────────────────────────────────────────────────────

export type UserTier = {
  id: string;
  name: string;
  storageQuotaBytes: number;
  unrestrictedUploadsAllowed: boolean;
  isDefault: boolean;
  /** Users following this tier, including default followers for the default. */
  memberCount: number;
};

export async function listUserTiers(): Promise<UserTier[]> {
  const rows = await db
    .select({
      id: userTiers.id,
      name: userTiers.name,
      storageQuotaBytes: userTiers.storageQuotaBytes,
      unrestrictedUploadsAllowed: userTiers.unrestrictedUploadsAllowed,
      isDefault: userTiers.isDefault,
      memberCount: sql<number>`(select count(*)::int from users u where u.tier_id = "user_tiers"."id" or (u.tier_id is null and "user_tiers"."is_default"))`,
    })
    .from(userTiers)
    .orderBy(asc(userTiers.storageQuotaBytes), asc(userTiers.name));

  return rows.map((row) => ({
    ...row,
    storageQuotaBytes: Number(row.storageQuotaBytes),
    memberCount: Number(row.memberCount),
  }));
}

export type TierInput = {
  name: string;
  storageQuotaBytes: number;
  unrestrictedUploadsAllowed: boolean;
};

export async function createUserTier(input: TierInput): Promise<string> {
  try {
    const [row] = await db
      .insert(userTiers)
      .values({ ...input, isDefault: false })
      .returning({ id: userTiers.id });
    return row.id;
  } catch (error) {
    throw isUniqueViolation(error) ? nameTaken(input.name) : error;
  }
}

/** Edits a tier. Everyone following it gets the new values on their next request. */
export async function updateUserTier(tierId: string, input: TierInput) {
  let rows: { id: string }[];
  try {
    rows = await db
      .update(userTiers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(userTiers.id, tierId))
      .returning({ id: userTiers.id });
  } catch (error) {
    throw isUniqueViolation(error) ? nameTaken(input.name) : error;
  }
  if (rows.length === 0) throw tierNotFound();
}

/**
 * Makes a tier the default. Users with no tier of their own (new signups
 * included) follow it from now on.
 */
export async function setDefaultUserTier(tierId: string) {
  await db.transaction(async (tx) => {
    const [tier] = await tx
      .select({ id: userTiers.id })
      .from(userTiers)
      .where(eq(userTiers.id, tierId))
      .for("update");
    if (!tier) throw tierNotFound();
    // Clear first: the partial unique index allows only one default.
    await tx
      .update(userTiers)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(userTiers.isDefault, true), ne(userTiers.id, tierId)));
    await tx
      .update(userTiers)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(userTiers.id, tierId));
  });
}

/**
 * Deletes a tier. Its members fall back to the default tier (the foreign key
 * sets their `tier_id` to null); their own overrides stay. The default tier
 * can't be deleted: make another tier the default first.
 */
export async function deleteUserTier(tierId: string) {
  const [tier] = await db
    .select({ isDefault: userTiers.isDefault })
    .from(userTiers)
    .where(eq(userTiers.id, tierId))
    .limit(1);
  if (!tier) throw tierNotFound();
  if (tier.isDefault) {
    throw new TierError("Make another tier the default before deleting this one.", "DEFAULT_TIER");
  }
  await db.delete(userTiers).where(and(eq(userTiers.id, tierId), eq(userTiers.isDefault, false)));
}

// ── Per-user ────────────────────────────────────────────────────────────────

/** Puts a user on a tier, or back on the default tier with `null`. */
export async function setUserTier(userId: string, tierId: string | null) {
  if (tierId !== null) {
    const [tier] = await db
      .select({ id: userTiers.id })
      .from(userTiers)
      .where(eq(userTiers.id, tierId))
      .limit(1);
    if (!tier) throw tierNotFound();
  }
  await updateUser(userId, { tierId });
}

/** Sets the user's own quota, or inherits the tier's again with `null`. */
export async function setUserStorageQuotaOverride(userId: string, bytes: number | null) {
  await updateUser(userId, { storageQuotaOverrideBytes: bytes });
}

/** Sets the user's own upload grant, or inherits the tier's again with `null`. */
export async function setUserUnrestrictedUploadsOverride(userId: string, allowed: boolean | null) {
  await updateUser(userId, { unrestrictedUploadsOverride: allowed });
}

async function updateUser(
  userId: string,
  values: Partial<Pick<typeof users.$inferInsert, "tierId" | "storageQuotaOverrideBytes" | "unrestrictedUploadsOverride">>,
) {
  const rows = await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (rows.length === 0) throw new TierError("User not found.", "USER_NOT_FOUND");
}

function tierNotFound() {
  return new TierError("Tier not found.", "TIER_NOT_FOUND");
}

function nameTaken(name: string) {
  return new TierError(`A tier named “${name}” already exists.`, "TIER_NAME_TAKEN");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: unknown } | null;
  return candidate?.code === "23505" || (candidate?.cause ? isUniqueViolation(candidate.cause) : false);
}
