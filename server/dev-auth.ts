import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const devUserSchema = z.enum(["owner", "collaborator"]);

const devUsers = {
  owner: {
    name: "Dev Owner",
    email: "dev.owner@vault.local",
  },
  collaborator: {
    name: "Dev Collaborator",
    email: "dev.collaborator@vault.local",
  },
} as const;

export function isDevLoginEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_DEV_LOGIN !== "false"
  );
}

async function createDevSession(userId: string) {
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.insert(sessions).values({ sessionToken, userId, expires });

  const cookieStore = await cookies();
  cookieStore.set("authjs.session-token", sessionToken, {
    expires,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function devSignInAction(formData: FormData) {
  "use server";

  if (!isDevLoginEnabled()) redirect("/login");

  const requestedUser = devUserSchema.parse(formData.get("devUser"));
  const devUser = devUsers[requestedUser];

  const [user] = await db
    .insert(users)
    .values({ name: devUser.name, email: devUser.email })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: devUser.name, updatedAt: sql`now()` },
    })
    .returning({ id: users.id });

  await createDevSession(user.id);
  redirect("/dashboard");
}

export async function devSignInAsEmailAction(formData: FormData) {
  "use server";

  if (!isDevLoginEnabled()) redirect("/login");

  const email = z.string().email().parse(formData.get("email"));

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });

  if (!user) {
    redirect(`/login?devError=${encodeURIComponent(`No user found with email: ${email}`)}`);
  }

  await createDevSession(user.id);
  redirect("/dashboard");
}
