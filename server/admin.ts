"use server";

import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { isUserBanActive, requireAdmin } from "@/server/authz";

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
};

export async function listUsersForAdmin(
  query?: string,
): Promise<AdminUserListItem[]> {
  await requireAdmin();

  const parsed = userSearchSchema.parse(query);
  const trimmedQuery = parsed?.trim();
  const likeQuery = trimmedQuery ? `%${trimmedQuery}%` : null;

  const rows = await db
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
    })
    .from(users)
    .where(
      likeQuery
        ? or(
            ilike(users.name, likeQuery),
            ilike(users.username, likeQuery),
            ilike(users.email, likeQuery),
          )
        : undefined,
    )
    .orderBy(asc(users.createdAt));

  return rows.map((user) => ({
    ...user,
    isBanActive: isUserBanActive(user),
  }));
}

export async function banUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const input = banUserSchema.parse({
    userId: formData.get("userId"),
    duration: formData.get("duration"),
    reason: formData.get("reason") ?? undefined,
  });

  if (input.userId === admin.id) {
    redirect("/dashboard/admin?error=self-ban");
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

  revalidatePath("/dashboard/admin");
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

  revalidatePath("/dashboard/admin");
}

export async function setUserRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const input = roleMutationSchema.parse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  if (input.userId === admin.id && input.role !== "admin") {
    redirect("/dashboard/admin?error=self-demote");
  }

  await db
    .update(users)
    .set({
      role: input.role,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  revalidatePath("/dashboard/admin");
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
