import "server-only";

import type {
  ExtensionCard,
  SettingsData,
} from "@/components/settings/settings-data";
import { getInstalledExtensionIds } from "@/lib/extension-host/manifests";
import { serverExtensionEntries } from "@/lib/extension-host/server";
import type { ExtensionManifest } from "@/lib/extension-api";
import type { ExtensionServerModule } from "@/lib/extension-api/server";
import { buildPreferences } from "@/lib/settings/preferences";
import { listOwnedDocumentOptionsForUser, listOwnedFolderOptionsForUser } from "@/server/extension-documents";
import { listConnectedAuthProviders } from "@/server/profile";
import {
  getViewerStylingPreference,
  listSnippetsForUser,
} from "@/server/snippets";
import {
  listUserExtensionSettings,
  listUserSettings,
} from "@/server/user-settings";

/**
 * Everything the settings modal shows, for one user, as plain data.
 *
 * The single place the settings modal's data is gathered — for the workspace
 * modal (through `loadWorkspaceSettingsDataAction`, when it opens) and for
 * `/dashboard/settings`. The pages themselves are built on the client by
 * `buildSettingsPagesFromData`: returning server-rendered pages from an action
 * does not work, because client components reachable only through an action's
 * result are missing from the route's client manifest.
 *
 * Extension pages are generated: one per *enabled* extension that declares
 * settings, in catalog order, after the Extensions page itself.
 */
export async function loadSettingsData(input: {
  profile: {
    id: string;
    email: string | null;
    image: string | null;
    nickname: string | null;
    username: string | null;
  };
  /** OAuth round-trip notices, shown on the Account page after a redirect. */
  accountNotice?: { connected?: string; error?: string; saved?: string };
}): Promise<SettingsData> {
  const { profile } = input;
  const [
    connectedProviders,
    userExtensionSettings,
    userSettings,
    snippetList,
    applyAuthorStyling,
  ] = await Promise.all([
    listConnectedAuthProviders(),
    listUserExtensionSettings({
      userId: profile.id,
      allowedExtensionIds: getInstalledExtensionIds(),
    }),
    listUserSettings({ userId: profile.id }),
    listSnippetsForUser(profile.id),
    getViewerStylingPreference(profile.id),
  ]);
  const preferences = buildPreferences(userSettings);
  const storedByExtension = new Map(
    userExtensionSettings.map((setting) => [setting.extensionId, setting]),
  );
  const isEnabled = (extension: ExtensionManifest) =>
    storedByExtension.get(extension.id)?.enabled ??
    extension.defaultEnabled ??
    false;
  const configurableExtensions = serverExtensionEntries
    .map(({ manifest }) => manifest)
    .filter(
      (extension) =>
        isEnabled(extension) && Boolean(extension.settings?.sections?.length),
    );
  // Only queried when some enabled extension actually has a folder field.
  const needsFolders = configurableExtensions.some((extension) =>
    extension.settings?.sections?.some((section) =>
      section.fields.some((field) => field.type === "folder"),
    ),
  );
  const needsDocuments = configurableExtensions.some((extension) =>
    extension.settings?.sections?.some((section) =>
      section.fields.some((field) => field.type === "document"),
    ),
  );
  const [folderOptions, documentOptions] = await Promise.all([
    needsFolders ? listOwnedFolderOptionsForUser(profile.id) : [],
    needsDocuments ? listOwnedDocumentOptionsForUser(profile.id) : [],
  ]);

  return {
    profile: {
      email: profile.email,
      image: profile.image,
      nickname: profile.nickname,
      username: profile.username,
    },
    connectedProviders,
    accountNotice: input.accountNotice ?? {},
    preferences,
    snippets: { list: snippetList, applyAuthorStyling },
    extensionCards: serverExtensionEntries.map(
      ({ manifest, server }): ExtensionCard => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        category: manifest.category ?? null,
        permissions: [...(manifest.permissions ?? [])],
        contributionLabels: getContributionLabels(manifest, server),
        enabled: isEnabled(manifest),
        hasSettings: Boolean(manifest.settings?.sections?.length),
      }),
    ),
    extensionPages: configurableExtensions.map((extension) => {
      const defaults = extension.settings?.defaults ?? {};

      return {
        id: extension.id,
        name: extension.name,
        description: extension.description ?? "",
        version: extension.version,
        sections: extension.settings?.sections ?? [],
        defaults,
        values: {
          ...defaults,
          ...(storedByExtension.get(extension.id)?.settings ?? {}),
        },
      };
    }),
    folderOptions,
    documentOptions,
  };
}

function getContributionLabels(
  extension: ExtensionManifest,
  server: ExtensionServerModule | null,
) {
  const labels: string[] = [];
  const syntax = extension.syntax;

  if (extension.slashCommands?.length) {
    labels.push("Slash commands");
  }

  if (syntax?.blocks?.length || syntax?.containers?.length) {
    labels.push("Markdown blocks");
  }

  if (syntax?.inline?.length) {
    labels.push("Inline values");
  }

  if (extension.overlays?.length) {
    labels.push("Document overlay");
  }

  if (extension.commands?.length) {
    labels.push("Commands");
  }

  if (server?.actions.some((action) => action.agent !== false)) {
    labels.push("Agent actions");
  }

  return labels;
}
