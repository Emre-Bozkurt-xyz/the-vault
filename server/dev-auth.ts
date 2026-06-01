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

export async function devSignInAction(formData: FormData) {
  "use server";

  if (!isDevLoginEnabled()) {
    redirect("/login");
  }

  const requestedUser = devUserSchema.parse(formData.get("devUser"));
  const devUser = devUsers[requestedUser];

  const [user] = await db
    .insert(users)
    .values({
      name: devUser.name,
      email: devUser.email,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: devUser.name,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: users.id,
    });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db
    .delete(sessions)
    .where(eq(sessions.userId, user.id));

  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires,
  });

  const cookieStore = await cookies();
  cookieStore.set("authjs.session-token", sessionToken, {
    expires,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  redirect("/dashboard");
}
