"use server";

import { signIn, signOut } from "@/auth";

/** Client-callable sign-out used by the command palette's `/logout`. */
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/**
 * Links another OAuth provider to the signed-in account (Settings -> Account).
 * Inline actions until that section became a client component.
 */
export async function connectGithubAction() {
  await signIn("github", { redirectTo: "/dashboard/settings?connected=github" });
}

export async function connectGoogleAction() {
  await signIn("google", { redirectTo: "/dashboard/settings?connected=google" });
}
