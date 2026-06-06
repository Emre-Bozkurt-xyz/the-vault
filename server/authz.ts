import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";

export type ActiveUser = {
  id: string;
  nickname: string | null;
  username: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
  profileCompletedAt: Date | null;
};

export function isUserBanActive(user: {
  bannedAt: Date | null;
  bannedUntil: Date | null;
}) {
  return Boolean(
    user.bannedAt && (!user.bannedUntil || user.bannedUntil > new Date()),
  );
}

export async function getCurrentUserForAccess() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [user] = await db
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
      profileCompletedAt: users.profileCompletedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    notFound();
  }

  return user;
}

export async function requireActiveUser() {
  const user = await getCurrentUserForAccess();

  if (isUserBanActive(user)) {
    redirect("/banned");
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireActiveUser();

  if (user.role !== "admin") {
    notFound();
  }

  return user;
}
