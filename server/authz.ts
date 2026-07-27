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

/**
 * Ban check for callers that identify a user by id rather than by session
 * cookie — the embed bridge's token-authenticated routes (docs/DEN_EMBED_BRIDGE.md
 * §C), which cannot use {@link requireActiveUser} because it redirects.
 *
 * Cookie-authenticated paths get their ban enforcement from `requireActiveUser`;
 * without this, a signed token would keep working for a banned user until it
 * expired, making the embed bridge a moderation bypass.
 */
export async function isUserActiveById(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ bannedAt: users.bannedAt, bannedUntil: users.bannedUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(user) && !isUserBanActive(user);
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
