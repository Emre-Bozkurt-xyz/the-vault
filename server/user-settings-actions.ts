"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { localExtensionRegistry, getLocalExtensionIds } from "@/lib/extensions/catalog";
import { canonicalizeBinding, isValidBinding } from "@/lib/shortcuts/binding";
import { isShortcutId } from "@/lib/shortcuts/registry";
import { requireActiveUser } from "@/server/authz";
import {
  upsertUserSetting,
  getUserExtensionSetting,
  listUserExtensionSettings,
  resetUserExtensionSettings,
  setUserExtensionEnabled,
  upsertUserExtensionSettings,
} from "@/server/user-settings";

const themeIdSchema = z.enum([
  "dark",
  "light",
  "midnight",
  "graphite",
  "paper",
  "system",
]);
const editorModeSchema = z.enum(["live", "read", "source"]);
const extensionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

export async function setUserExtensionEnabledAction(formData: FormData) {
  const user = await requireActiveUser();
  const extensionId = extensionIdSchema.parse(formData.get("extensionId"));
  const enabled = formData.get("enabled") === "true";

  await setUserExtensionEnabled({
    userId: user.id,
    extensionId,
    enabled,
    allowedExtensionIds: getLocalExtensionIds(),
  });

  revalidatePath("/dashboard/settings");
}

export async function saveAppearanceSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      themeId: themeIdSchema,
      accentColor: z.enum(["neutral", "blue", "green", "rose"]),
      editorFontSize: z.number().int().min(13).max(22),
      readingFontSize: z.number().int().min(14).max(24),
      monospaceFont: z.enum(["geist", "system", "serif"]),
      readableLineLength: z.boolean(),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "appearance",
    key: "theme",
    value: parsed,
  });

  revalidatePath("/dashboard/settings");
}

export async function saveWorkspaceSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const value = z
    .object({
      restoreTabs: z.boolean(),
      rememberPanels: z.boolean(),
      openLinksInNewTab: z.boolean(),
      defaultPanel: z.enum(["files", "search", "gallery", "assets", "docs"]),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "workspace",
    key: "defaults",
    value,
  });

  revalidatePath("/dashboard/settings");
}

export async function saveEditorSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const value = z
    .object({
      defaultMode: editorModeSchema,
      lineNumbers: z.boolean(),
      readableLineLength: z.boolean(),
      autoSaveDelayMs: z.coerce.number().int().min(300).max(5000),
      spellcheck: z.boolean(),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "editor",
    key: "defaults",
    value,
  });

  revalidatePath("/dashboard/settings");
}

export async function saveFilesAssetsSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const value = z
    .object({
      defaultImageLayout: z.enum(["block", "wrap", "inline"]),
      defaultImageWidth: z.enum(["small", "medium", "large", "full"]),
      copyEmbedsWithTitle: z.boolean(),
      openPdfsInNewTab: z.boolean(),
      showPrivatePublishWarning: z.boolean(),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "files-assets",
    key: "defaults",
    value,
  });

  revalidatePath("/dashboard/settings");
}

export async function saveHotkeysSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      editorShortcutsEnabled: z.boolean(),
      vimMode: z.boolean(),
      keybindings: z.record(z.string(), z.string().nullable()),
    })
    .parse(input);

  // Keep only known shortcut ids with valid (canonicalized) chords or null.
  const keybindings: Record<string, string | null> = {};
  for (const [id, binding] of Object.entries(parsed.keybindings)) {
    if (!isShortcutId(id)) {
      continue;
    }
    if (binding === null) {
      keybindings[id] = null;
    } else if (isValidBinding(binding)) {
      keybindings[id] = canonicalizeBinding(binding) ?? binding;
    }
  }

  await upsertUserSetting({
    userId: user.id,
    namespace: "hotkeys",
    key: "defaults",
    value: {
      editorShortcutsEnabled: parsed.editorShortcutsEnabled,
      vimMode: parsed.vimMode,
      keybindings,
    },
  });

  revalidatePath("/dashboard/settings");
}

export async function saveCoreFeaturesSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const value = z
    .object({
      livePreview: z.boolean(),
      wikiLinks: z.boolean(),
      assetEmbeds: z.boolean(),
      callouts: z.boolean(),
      math: z.boolean(),
      documentEmbeds: z.boolean(),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "workspace",
    key: "core-features",
    value,
  });

  revalidatePath("/dashboard/settings");
}

export async function saveAdvancedSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const value = z
    .object({
      debugHistoryRestore: z.boolean(),
      confirmDestructiveActions: z.boolean(),
      reduceMotion: z.boolean(),
    })
    .parse(input);

  await upsertUserSetting({
    userId: user.id,
    namespace: "advanced",
    key: "defaults",
    value,
  });

  revalidatePath("/dashboard/settings");
}

export async function resetUserExtensionSettingsAction(formData: FormData) {
  const user = await requireActiveUser();
  const extensionId = extensionIdSchema.parse(formData.get("extensionId"));
  const extension = localExtensionRegistry.getExtension(extensionId);

  if (!extension) {
    throw new Error("Unknown extension id.");
  }

  const existing = await getUserExtensionSetting({
    userId: user.id,
    extensionId,
    allowedExtensionIds: getLocalExtensionIds(),
  });

  await resetUserExtensionSettings({
    userId: user.id,
    extensionId,
    enabled: existing?.enabled ?? extension.defaultEnabled ?? false,
    settings: extension.settings?.defaults ?? {},
    version: extension.version,
    allowedExtensionIds: getLocalExtensionIds(),
  });

  revalidatePath("/dashboard/settings");
}

export async function upsertUserExtensionSettingsAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      extensionId: extensionIdSchema,
      settings: z.record(z.string(), z.unknown()),
    })
    .parse(input);
  const extension = localExtensionRegistry.getExtension(parsed.extensionId);

  if (!extension) {
    throw new Error("Unknown extension id.");
  }

  const existing = await getUserExtensionSetting({
    userId: user.id,
    extensionId: parsed.extensionId,
    allowedExtensionIds: getLocalExtensionIds(),
  });
  const settings = validateExtensionSettings(
    parsed.extensionId,
    parsed.settings,
  );

  return upsertUserExtensionSettings({
    userId: user.id,
    extensionId: parsed.extensionId,
    enabled: existing?.enabled ?? extension.defaultEnabled ?? false,
    settings,
    version: extension.version,
    allowedExtensionIds: getLocalExtensionIds(),
  });
}

export async function listCurrentUserExtensionSettings() {
  const user = await requireActiveUser();

  return listUserExtensionSettings({
    userId: user.id,
    allowedExtensionIds: getLocalExtensionIds(),
  });
}

function validateExtensionSettings(
  extensionId: string,
  settings: Record<string, unknown>,
) {
  const extensionSettings =
    localExtensionRegistry.getExtensionSettingsSchema(extensionId);

  if (!extensionSettings?.schema) {
    return settings;
  }

  return extensionSettings.schema.parse({
    ...(extensionSettings.defaults ?? {}),
    ...settings,
  });
}
