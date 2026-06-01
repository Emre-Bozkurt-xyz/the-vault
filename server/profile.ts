"use server";

import { and, eq, ne, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be 30 characters or fewer.")
  .regex(
    /^[a-z0-9_]+$/,
    "Use lowercase letters, numbers, and underscores only.",
  );

const nicknameSchema = z
  .string()
  .trim()
  .min(1, "Nickname is required.")
  .max(80, "Nickname must be 80 characters or fewer.");

const completeProfileSchema = z.object({
  username: usernameSchema,
  nickname: nicknameSchema,
});

const userSearchSchema = z.string().trim().min(1).max(80);

export type UserSearchResult = {
  id: string;
  nickname: string | null;
  username: string | null;
  email: string | null;
  image: string | null;
};

export type UsernameAvailability =
  | { available: true; normalizedUsername: string; message: string }
  | { available: false; normalizedUsername: string; message: string };

export async function getCurrentUserProfile() {
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

export async function requireCompletedProfile() {
  const user = await getCurrentUserProfile();

  if (!user.profileCompletedAt || !user.username || !user.nickname) {
    redirect("/onboarding");
  }

  return user;
}

export async function completeProfileAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = completeProfileSchema.parse({
    username: formData.get("username"),
    nickname: formData.get("nickname"),
  });

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, input.username), ne(users.id, session.user.id)))
    .limit(1);

  if (existing) {
    redirect("/onboarding?error=username-taken");
  }

  try {
    await db
      .update(users)
      .set({
        username: input.username,
        name: input.nickname,
        profileCompletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, session.user.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect("/onboarding?error=username-taken");
    }

    throw error;
  }

  redirect("/dashboard");
}

export async function updateProfileAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const input = completeProfileSchema.parse({
    username: formData.get("username"),
    nickname: formData.get("nickname"),
  });

  const availability = await checkUsernameAvailability(
    input.username,
    session.user.id,
  );

  if (!availability.available) {
    redirect("/dashboard/settings?error=username-taken");
  }

  try {
    await db
      .update(users)
      .set({
        username: input.username,
        name: input.nickname,
        profileCompletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, session.user.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect("/dashboard/settings?error=username-taken");
    }

    throw error;
  }

  redirect("/dashboard/settings?saved=profile");
}

export async function checkUsernameAvailability(
  username: string,
  currentUserId?: string,
): Promise<UsernameAvailability> {
  const parsed = usernameSchema.safeParse(username);
  const normalizedUsername = username.trim().toLowerCase();

  if (!parsed.success) {
    return {
      available: false,
      normalizedUsername,
      message:
        parsed.error.issues[0]?.message ??
        "Use lowercase letters, numbers, and underscores only.",
    };
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, parsed.data))
    .limit(1);

  if (existing && existing.id !== currentUserId) {
    return {
      available: false,
      normalizedUsername: parsed.data,
      message: "That username is already taken.",
    };
  }

  return {
    available: true,
    normalizedUsername: parsed.data,
    message: existing ? "This is your current username." : "Username available.",
  };
}

export async function searchUsersForCurrentUser(query: string) {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const parsed = userSearchSchema.safeParse(query);

  if (!parsed.success) {
    return [];
  }

  return searchUsers(parsed.data, session.user.id);
}

export async function searchUsers(query: string, currentUserId: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const likeQuery = `%${normalizedQuery}%`;

  return db
    .select({
      id: users.id,
      nickname: users.name,
      username: users.username,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(
      and(
        ne(users.id, currentUserId),
        or(
          sql`lower(${users.name}) like ${likeQuery}`,
          sql`lower(${users.username}) like ${likeQuery}`,
          sql`lower(${users.email}) like ${likeQuery}`,
        ),
      ),
    )
    .orderBy(users.username, users.email)
    .limit(8);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  return "cause" in error && isUniqueViolation(error.cause);
}
