"use server";

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { assets, users, type UserRole } from "@/db/schema";
import { isUserBanActive, requireAdmin } from "@/server/authz";

const USERS_PATH = "/dashboard/admin/users";

const userIdSchema = z.string().uuid();
const userSearchSchema = z.string().trim().max(120).optional();
const roleSchema = z.enum(["user", "admin"]);
const banDurationSchema = z.enum(["1d", "7d", "30d", "forever"]);

const banUserSchema = z.object({
  userId: userIdSchema,
  duration: banDurationSchema,
  reason: z.string().trim().max(500).optional(),
});

const roleMutationSchema = z.object({
  userId: userIdSchema,
  role: roleSchema,
});

export type AdminUserListItem = {
  id: string;
  nickname: string | null;
  username: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  isBanActive: boolean;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  assetCount: number;
};

export type AdminUserSort =
  | "joined_desc"
  | "joined_asc"
  | "name_asc"
  | "storage_desc"
  | "role_desc";

const userSortSchema = z
  .enum(["joined_desc", "joined_asc", "name_asc", "storage_desc", "role_desc"])
  .default("joined_desc");
const roleFilterSchema = z.enum(["all", "admin", "user"]).default("all");
const statusFilterSchema = z.enum(["all", "active", "banned"]).default("all");
const pageSchema = z.coerce.number().int().min(1).default(1);

const ADMIN_USERS_PAGE_SIZE = 25;

export type AdminUserListResult = {
  items: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

// Matches isUserBanActive but in SQL so we can filter/paginate in the database.
const activeBanCondition = sql`${users.bannedAt} is not null and (${users.bannedUntil} is null or ${users.bannedUntil} > now())`;

export async function listUsersForAdmin(options: {
  query?: string;
  role?: string;
  status?: string;
  sort?: string;
  page?: number;
} = {}): Promise<AdminUserListResult> {
  await requireAdmin();

  const trimmedQuery = userSearchSchema.parse(options.query)?.trim();
  const role = roleFilterSchema.parse(options.role ?? "all");
  const status = statusFilterSchema.parse(options.status ?? "all");
  const sort = userSortSchema.parse(options.sort ?? "joined_desc");
  const page = pageSchema.parse(options.page ?? 1);
  const pageSize = ADMIN_USERS_PAGE_SIZE;

  const conditions: SQL[] = [];

  if (trimmedQuery) {
    const search = or(
      ilike(users.name, `%${trimmedQuery}%`),
      ilike(users.username, `%${trimmedQuery}%`),
      ilike(users.email, `%${trimmedQuery}%`),
    );
    if (search) conditions.push(search);
  }

  if (role !== "all") {
    conditions.push(eq(users.role, role));
  }

  if (status === "banned") {
    conditions.push(activeBanCondition);
  } else if (status === "active") {
    conditions.push(sql`not (${activeBanCondition})`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const assetCount = sql<number>`count(${assets.id}) filter (where ${assets.status} = 'ready' and ${assets.deletedAt} is null)::int`;

  const orderBy =
    sort === "joined_asc"
      ? asc(users.createdAt)
      : sort === "name_asc"
        ? asc(users.name)
        : sort === "storage_desc"
          ? desc(users.storageUsedBytes)
          : sort === "role_desc"
            ? desc(users.role)
            : desc(users.createdAt);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: users.id,
        nickname: users.name,
        username: users.username,
        email: users.email,
        image: users.image,
        role: users.role,
        bannedAt: users.bannedAt,
        bannedUntil: users.bannedUntil,
        banReason: users.banReason,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        storageUsedBytes: users.storageUsedBytes,
        storageQuotaBytes: users.storageQuotaBytes,
        assetCount,
      })
      .from(users)
      .leftJoin(assets, eq(assets.ownerId, users.id))
      .where(where)
      .groupBy(users.id)
      .orderBy(orderBy, asc(users.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);

  return {
    items: rows.map((user) => ({
      ...user,
      storageUsedBytes: Number(user.storageUsedBytes),
      storageQuotaBytes: Number(user.storageQuotaBytes),
      assetCount: Number(user.assetCount),
      isBanActive: isUserBanActive(user),
    })),
    total: Number(totals?.total ?? 0),
    page,
    pageSize,
  };
}

export type AdminUserOverview = {
  totalUsers: number;
  adminCount: number;
  bannedCount: number;
  newThisWeek: number;
};

export async function getAdminUserOverview(): Promise<AdminUserOverview> {
  await requireAdmin();

  const [row] = await db
    .select({
      totalUsers: sql<number>`count(*)::int`,
      adminCount: sql<number>`count(*) filter (where ${users.role} = 'admin')::int`,
      bannedCount: sql<number>`count(*) filter (where ${activeBanCondition})::int`,
      newThisWeek: sql<number>`count(*) filter (where ${users.createdAt} > now() - interval '7 days')::int`,
    })
    .from(users);

  return {
    totalUsers: Number(row?.totalUsers ?? 0),
    adminCount: Number(row?.adminCount ?? 0),
    bannedCount: Number(row?.bannedCount ?? 0),
    newThisWeek: Number(row?.newThisWeek ?? 0),
  };
}

export async function banUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const input = banUserSchema.parse({
    userId: formData.get("userId"),
    duration: formData.get("duration"),
    reason: formData.get("reason") ?? undefined,
  });

  if (input.userId === admin.id) {
    redirect(`${USERS_PATH}?error=self-ban`);
  }

  await db
    .update(users)
    .set({
      bannedAt: sql`now()`,
      bannedUntil: banUntilForDuration(input.duration),
      banReason: input.reason || null,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  revalidatePath(USERS_PATH);
}

export async function unbanUserAction(formData: FormData) {
  await requireAdmin();
  const userId = userIdSchema.parse(formData.get("userId"));

  await db
    .update(users)
    .set({
      bannedAt: null,
      bannedUntil: null,
      banReason: null,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));

  revalidatePath(USERS_PATH);
}

export async function setUserRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const input = roleMutationSchema.parse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  if (input.userId === admin.id && input.role !== "admin") {
    redirect(`${USERS_PATH}?error=self-demote`);
  }

  await db
    .update(users)
    .set({
      role: input.role,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  revalidatePath(USERS_PATH);
}

function banUntilForDuration(duration: z.infer<typeof banDurationSchema>) {
  if (duration === "forever") {
    return null;
  }

  const days = duration === "1d" ? 1 : duration === "7d" ? 7 : 30;
  const until = new Date();
  until.setDate(until.getDate() + days);
  return until;
}
