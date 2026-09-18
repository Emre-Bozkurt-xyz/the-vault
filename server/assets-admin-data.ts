/**
 * Data access for `@/server/assets-admin`, for callers that have already
 * authenticated the user.
 *
 * These functions take a `userId` and trust it. They live here, in a module with
 * **no** `"use server"` directive, because every export of such a module is
 * registered as a callable server action — and as endpoints their only protection
 * would be that no client bundle happens to contain their action id. Never add the
 * directive to this file, and never accept a user id in an action.
 */

// Type-only, so this import is erased and the pairing stays acyclic at runtime.
import type {
  AdminAssetItem,
  AdminUserStorageItem,
} from "@/server/assets-admin";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assets, users } from "@/db/schema";
import {
  buildAssetContentUrl,
} from "@/server/assets";
import { requireAdmin } from "@/server/authz";

export async function getUserStorageForAdmin(
  userId: string,
): Promise<AdminUserStorageItem | null> {
  await requireAdmin();
  const id = userIdSchema.parse(userId);

  const assetCount = sql<number>`count(${assets.id}) filter (where ${assets.status} = 'ready' and ${assets.deletedAt} is null)::int`;
  const actualBytes = sql<number>`coalesce(sum(${assets.sizeBytes}) filter (where ${assets.status} = 'ready' and ${assets.deletedAt} is null), 0)`;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      storageUsedBytes: users.storageUsedBytes,
      storageQuotaBytes: users.storageQuotaBytes,
      assetCount,
      actualBytes,
    })
    .from(users)
    .leftJoin(assets, eq(assets.ownerId, users.id))
    .where(eq(users.id, id))
    .groupBy(users.id)
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...row,
    storageUsedBytes: Number(row.storageUsedBytes),
    storageQuotaBytes: Number(row.storageQuotaBytes),
    assetCount: Number(row.assetCount),
    actualBytes: Number(row.actualBytes),
  };
}

export async function listAssetsForUserAdmin(
  userId: string,
): Promise<AdminAssetItem[]> {
  await requireAdmin();
  const ownerId = userIdSchema.parse(userId);

  const rows = await db
    .select({
      id: assets.id,
      displayName: assets.displayName,
      kind: assets.kind,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, ownerId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(desc(assets.sizeBytes))
    .limit(200);

  return rows.map((row) => ({
    ...row,
    sizeBytes: Number(row.sizeBytes),
    url: buildAssetContentUrl(row.id),
  }));
}

export const userIdSchema = z.string().uuid();
