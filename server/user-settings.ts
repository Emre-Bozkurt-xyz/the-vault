import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  userExtensionSettings,
  userSettings,
  type UserSettingNamespace,
} from "@/db/schema";

export type UserSettingValue = Record<string, unknown>;
export type UserExtensionSettingsValue = Record<string, unknown>;

const userIdSchema = z.string().uuid();

const userSettingNamespaceSchema = z.enum([
  "appearance",
  "editor",
  "workspace",
  "files-assets",
  "hotkeys",
  "advanced",
]);

const settingKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i);

const extensionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

const objectValueSchema = z.record(z.string(), z.unknown());

function normalizeUserId(userId: string) {
  return userIdSchema.parse(userId);
}

function normalizeNamespace(namespace: string): UserSettingNamespace {
  return userSettingNamespaceSchema.parse(namespace);
}

function normalizeSettingKey(key: string) {
  return settingKeySchema.parse(key);
}

function normalizeExtensionId(
  extensionId: string,
  options?: { allowedExtensionIds?: readonly string[] },
) {
  const normalized = extensionIdSchema.parse(extensionId);

  if (
    options?.allowedExtensionIds &&
    !options.allowedExtensionIds.includes(normalized)
  ) {
    throw new Error("Unknown extension id.");
  }

  return normalized;
}

export async function getUserSetting(input: {
  userId: string;
  namespace: string;
  key: string;
}) {
  const userId = normalizeUserId(input.userId);
  const namespace = normalizeNamespace(input.namespace);
  const key = normalizeSettingKey(input.key);

  const [row] = await db
    .select()
    .from(userSettings)
    .where(
      and(
        eq(userSettings.userId, userId),
        eq(userSettings.namespace, namespace),
        eq(userSettings.key, key),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listUserSettings(input: {
  userId: string;
  namespace?: string;
}) {
  const userId = normalizeUserId(input.userId);
  const namespace = input.namespace
    ? normalizeNamespace(input.namespace)
    : null;

  return db
    .select()
    .from(userSettings)
    .where(
      and(
        eq(userSettings.userId, userId),
        namespace ? eq(userSettings.namespace, namespace) : undefined,
      ),
    )
    .orderBy(userSettings.namespace, userSettings.key);
}

export async function upsertUserSetting(input: {
  userId: string;
  namespace: string;
  key: string;
  value: UserSettingValue;
}) {
  const userId = normalizeUserId(input.userId);
  const namespace = normalizeNamespace(input.namespace);
  const key = normalizeSettingKey(input.key);
  const value = objectValueSchema.parse(input.value);

  const [row] = await db
    .insert(userSettings)
    .values({
      userId,
      namespace,
      key,
      value,
    })
    .onConflictDoUpdate({
      target: [userSettings.userId, userSettings.namespace, userSettings.key],
      set: {
        value,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return row;
}

export async function deleteUserSetting(input: {
  userId: string;
  namespace: string;
  key: string;
}) {
  const userId = normalizeUserId(input.userId);
  const namespace = normalizeNamespace(input.namespace);
  const key = normalizeSettingKey(input.key);

  const [row] = await db
    .delete(userSettings)
    .where(
      and(
        eq(userSettings.userId, userId),
        eq(userSettings.namespace, namespace),
        eq(userSettings.key, key),
      ),
    )
    .returning();

  return row ?? null;
}

export async function listUserExtensionSettings(input: {
  userId: string;
  allowedExtensionIds?: readonly string[];
}) {
  const userId = normalizeUserId(input.userId);
  const rows = await db
    .select()
    .from(userExtensionSettings)
    .where(eq(userExtensionSettings.userId, userId))
    .orderBy(userExtensionSettings.extensionId);

  if (!input.allowedExtensionIds) {
    return rows;
  }

  return rows.filter((row) =>
    input.allowedExtensionIds?.includes(row.extensionId),
  );
}

export async function getUserExtensionSetting(input: {
  userId: string;
  extensionId: string;
  allowedExtensionIds?: readonly string[];
}) {
  const userId = normalizeUserId(input.userId);
  const extensionId = normalizeExtensionId(input.extensionId, {
    allowedExtensionIds: input.allowedExtensionIds,
  });

  const [row] = await db
    .select()
    .from(userExtensionSettings)
    .where(
      and(
        eq(userExtensionSettings.userId, userId),
        eq(userExtensionSettings.extensionId, extensionId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function setUserExtensionEnabled(input: {
  userId: string;
  extensionId: string;
  enabled: boolean;
  allowedExtensionIds?: readonly string[];
}) {
  const existing = await getUserExtensionSetting({
    userId: input.userId,
    extensionId: input.extensionId,
    allowedExtensionIds: input.allowedExtensionIds,
  });

  return upsertUserExtensionSettings({
    userId: input.userId,
    extensionId: input.extensionId,
    enabled: input.enabled,
    settings: existing?.settings ?? {},
    version: existing?.version ?? 1,
    allowedExtensionIds: input.allowedExtensionIds,
  });
}

export async function upsertUserExtensionSettings(input: {
  userId: string;
  extensionId: string;
  enabled?: boolean;
  settings: UserExtensionSettingsValue;
  version?: number;
  allowedExtensionIds?: readonly string[];
}) {
  const userId = normalizeUserId(input.userId);
  const extensionId = normalizeExtensionId(input.extensionId, {
    allowedExtensionIds: input.allowedExtensionIds,
  });
  const settings = objectValueSchema.parse(input.settings);
  const version = input.version ?? 1;

  const [row] = await db
    .insert(userExtensionSettings)
    .values({
      userId,
      extensionId,
      enabled: input.enabled ?? false,
      settings,
      version,
    })
    .onConflictDoUpdate({
      target: [
        userExtensionSettings.userId,
        userExtensionSettings.extensionId,
      ],
      set: {
        enabled: input.enabled ?? sql`${userExtensionSettings.enabled}`,
        settings,
        version,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return row;
}

export async function resetUserExtensionSettings(input: {
  userId: string;
  extensionId: string;
  enabled?: boolean;
  settings?: UserExtensionSettingsValue;
  version?: number;
  allowedExtensionIds?: readonly string[];
}) {
  return upsertUserExtensionSettings({
    userId: input.userId,
    extensionId: input.extensionId,
    enabled: input.enabled ?? false,
    settings: input.settings ?? {},
    version: input.version ?? 1,
    allowedExtensionIds: input.allowedExtensionIds,
  });
}
