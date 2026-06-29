"use server";

import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { assets, users, type AssetKind, type AssetVisibility } from "@/db/schema";
import {
  adminDeleteAsset,
  buildAssetContentUrl,
  recalculateUserStorage,
} from "@/server/assets";
import { requireAdmin } from "@/server/authz";

const ADMIN_ASSETS_PATH = "/dashboard/admin/assets";

const userIdSchema = z.string().uuid();
const assetIdSchema = z.string().uuid();
const searchSchema = z.string().trim().max(120).optional();

const userSortSchema = z
  .enum(["usage_desc", "usage_asc", "quota_desc", "assets_desc", "name_asc"])
  .default("usage_desc");
export type AdminUserStorageSort = z.infer<typeof userSortSchema>;

const minBytesSchema = z.coerce.number().int().min(0).default(0);

export type AssetStorageOverview = {
  totalAssets: number;
  totalBytes: number;
  imageCount: number;
  pdfCount: number;
  publicCount: number;
  privateCount: number;
  totalQuotaBytes: number;
  trackedUsedBytes: number;
  userCount: number;
  usersWithAssets: number;
};

export type AdminUserStorageItem = {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  assetCount: number;
  actualBytes: number;
};

export type AdminAssetItem = {
  id: string;
  displayName: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  visibility: AssetVisibility;
  createdAt: Date;
  url: string;
};

export async function getAssetStorageOverview(): Promise<AssetStorageOverview> {
  await requireAdmin();

  const [assetStats] = await db
    .select({
      totalAssets: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`,
      imageCount: sql<number>`count(*) filter (where ${assets.kind} = 'image')::int`,
      pdfCount: sql<number>`count(*) filter (where ${assets.kind} = 'pdf')::int`,
      publicCount: sql<number>`count(*) filter (where ${assets.visibility} = 'public')::int`,
    })
    .from(assets)
    .where(and(eq(assets.status, "ready"), isNull(assets.deletedAt)));

  const [userStats] = await db
    .select({
      totalQuotaBytes: sql<number>`coalesce(sum(${users.storageQuotaBytes}), 0)`,
      trackedUsedBytes: sql<number>`coalesce(sum(${users.storageUsedBytes}), 0)`,
      userCount: sql<number>`count(*)::int`,
      usersWithAssets: sql<number>`count(*) filter (where ${users.storageUsedBytes} > 0)::int`,
    })
    .from(users);

  const totalAssets = Number(assetStats?.totalAssets ?? 0);
  const publicCount = Number(assetStats?.publicCount ?? 0);

  return {
    totalAssets,
    totalBytes: Number(assetStats?.totalBytes ?? 0),
    imageCount: Number(assetStats?.imageCount ?? 0),
    pdfCount: Number(assetStats?.pdfCount ?? 0),
    publicCount,
    privateCount: totalAssets - publicCount,
    totalQuotaBytes: Number(userStats?.totalQuotaBytes ?? 0),
    trackedUsedBytes: Number(userStats?.trackedUsedBytes ?? 0),
    userCount: Number(userStats?.userCount ?? 0),
    usersWithAssets: Number(userStats?.usersWithAssets ?? 0),
  };
}

export async function listUserStorageForAdmin(options: {
  query?: string;
  sort?: string;
  minBytes?: number;
}): Promise<AdminUserStorageItem[]> {
  await requireAdmin();

  const query = searchSchema.parse(options.query);
  const sort = userSortSchema.parse(options.sort ?? "usage_desc");
  const minBytes = minBytesSchema.parse(options.minBytes ?? 0);

  const likeQuery = query ? `%${query}%` : null;
  const conditions: SQL[] = [];

  if (likeQuery) {
    const search = or(
      ilike(users.name, likeQuery),
      ilike(users.username, likeQuery),
      ilike(users.email, likeQuery),
    );
    if (search) {
      conditions.push(search);
    }
  }

  if (minBytes > 0) {
    conditions.push(sql`${users.storageUsedBytes} >= ${minBytes}`);
  }

  const assetCount = sql<number>`count(${assets.id}) filter (where ${assets.status} = 'ready' and ${assets.deletedAt} is null)::int`;
  const actualBytes = sql<number>`coalesce(sum(${assets.sizeBytes}) filter (where ${assets.status} = 'ready' and ${assets.deletedAt} is null), 0)`;

  const orderBy =
    sort === "usage_asc"
      ? asc(users.storageUsedBytes)
      : sort === "quota_desc"
        ? desc(users.storageQuotaBytes)
        : sort === "assets_desc"
          ? desc(assetCount)
          : sort === "name_asc"
            ? asc(users.name)
            : desc(users.storageUsedBytes);

  const rows = await db
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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(users.id)
    .orderBy(orderBy, asc(users.name))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    storageUsedBytes: Number(row.storageUsedBytes),
    storageQuotaBytes: Number(row.storageQuotaBytes),
    assetCount: Number(row.assetCount),
    actualBytes: Number(row.actualBytes),
  }));
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

export async function deleteAssetAsAdminAction(formData: FormData) {
  await requireAdmin();
  const assetId = assetIdSchema.parse(formData.get("assetId"));

  await adminDeleteAsset(assetId);

  revalidatePath(ADMIN_ASSETS_PATH);
}

export async function recalcUserStorageAction(formData: FormData) {
  await requireAdmin();
  const userId = userIdSchema.parse(formData.get("userId"));

  await recalculateUserStorage(userId);

  revalidatePath(ADMIN_ASSETS_PATH);
}

// Quota is entered in MiB in the admin UI; cap at 1 TiB to avoid absurd values.
const quotaMbSchema = z.coerce.number().int().min(0).max(1024 * 1024);

export async function updateUserQuotaAction(formData: FormData) {
  await requireAdmin();
  const userId = userIdSchema.parse(formData.get("userId"));
  const quotaMb = quotaMbSchema.parse(formData.get("quotaMb"));

  await db
    .update(users)
    .set({
      storageQuotaBytes: quotaMb * 1024 * 1024,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  revalidatePath(ADMIN_ASSETS_PATH);
  revalidatePath("/dashboard/admin/users");
}
