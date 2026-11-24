"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/server/authz";
import {
  TierError,
  createUserTier,
  deleteUserTier,
  setDefaultUserTier,
  setUserTier,
  updateUserTier,
  type TierInput,
} from "@/server/user-tiers";

const TIERS_PATH = "/dashboard/admin/tiers";
const MIB = 1024 * 1024;

const idSchema = z.string().uuid();
const tierFormSchema = z.object({
  name: z.string().trim().min(1).max(40),
  // MiB, capped at 1 TiB like the per-user quota.
  quotaMb: z.coerce.number().int().min(0).max(1024 * 1024),
  unrestricted: z.boolean(),
});

function readTierForm(formData: FormData): TierInput {
  const input = tierFormSchema.parse({
    name: formData.get("name"),
    quotaMb: formData.get("quotaMb"),
    unrestricted: formData.get("unrestricted") === "on",
  });
  return {
    name: input.name,
    storageQuotaBytes: input.quotaMb * MIB,
    unrestrictedUploadsAllowed: input.unrestricted,
  };
}

/** Runs a tier change; a {@link TierError} comes back to the page as `?error=`. */
async function runTierChange(change: () => Promise<unknown>) {
  try {
    await change();
  } catch (error) {
    if (error instanceof TierError) redirect(`${TIERS_PATH}?error=${error.code}`);
    throw error;
  }
  revalidatePath(TIERS_PATH);
  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/assets");
}

export async function createTierAction(formData: FormData) {
  await requireAdmin();
  const input = readTierForm(formData);
  await runTierChange(() => createUserTier(input));
}

export async function updateTierAction(formData: FormData) {
  await requireAdmin();
  const tierId = idSchema.parse(formData.get("tierId"));
  const input = readTierForm(formData);
  await runTierChange(() => updateUserTier(tierId, input));
}

export async function setDefaultTierAction(formData: FormData) {
  await requireAdmin();
  const tierId = idSchema.parse(formData.get("tierId"));
  await runTierChange(() => setDefaultUserTier(tierId));
}

export async function deleteTierAction(formData: FormData) {
  await requireAdmin();
  const tierId = idSchema.parse(formData.get("tierId"));
  await runTierChange(() => deleteUserTier(tierId));
}

/** Puts a user on a tier; `default` returns them to the default tier. */
export async function setUserTierAction(formData: FormData) {
  await requireAdmin();
  const userId = idSchema.parse(formData.get("userId"));
  const raw = formData.get("tierId");
  const tierId = raw === "default" ? null : idSchema.parse(raw);
  await setUserTier(userId, tierId);
  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/assets");
  revalidatePath(TIERS_PATH);
}
