"use server";

import { signOut } from "@/auth";

/** Client-callable sign-out used by the command palette's `/logout`. */
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
