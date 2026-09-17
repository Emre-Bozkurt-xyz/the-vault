import "server-only";

import { AccountSettingsSection } from "@/components/settings/AccountSettingsSection";
import { ExtensionBrowserSection } from "@/components/settings/ExtensionBrowserSection";
import { ExtensionSettingsPage } from "@/components/settings/ExtensionSettingsPage";
import {
  AdvancedSettingsSection,
  AppearanceSettingsSection,
  CoreCommandsSettingsSection,
  CoreFeaturesSettingsSection,
  EditorSettingsSection,
  FilesAssetsSettingsSection,
  HotkeysSettingsSection,
  WorkspaceSettingsSection,
} from "@/components/settings/PreferenceSettingsSections";
import {
  extensionSettingsPageId,
  type SettingsPage,
} from "@/components/settings/settings-pages";
import { SnippetsSettingsSection } from "@/components/settings/SnippetsSettingsSection";
import {
  getLocalExtensionIds,
  localBuiltInExtensions,
} from "@/lib/extensions/catalog";
import { buildPreferences } from "@/lib/settings/preferences";
import { listOwnedFolderOptionsForUser } from "@/server/definitions-data";
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
 * Every page of the settings modal, for one user.
 *
 * The single place the settings modal is assembled. It used to be built twice —
 * in the workspace layout's mount and in `/dashboard/settings` — and the two had
 * already drifted (the dashboard copy had no Snippets page).
 *
 * Extension pages are generated: one per *enabled* extension that declares
 * settings, in catalog order, after the Extensions page itself.
 */
export async function buildSettingsPages(input: {
  profile: {
    id: string;
    email: string | null;
    image: string | null;
    nickname: string | null;
    username: string | null;
  };
  /** OAuth round-trip notices, shown on the Account page after a redirect. */
  accountNotice?: { connected?: string; error?: string; saved?: string };
}): Promise<SettingsPage[]> {
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
      allowedExtensionIds: getLocalExtensionIds(),
    }),
    listUserSettings({ userId: profile.id }),
    listSnippetsForUser(profile.id),
    getViewerStylingPreference(profile.id),
  ]);
  const preferences = buildPreferences(userSettings);
  const storedByExtension = new Map(
    userExtensionSettings.map((setting) => [setting.extensionId, setting]),
  );
  const configurableExtensions = localBuiltInExtensions.filter(
    (extension) =>
      (storedByExtension.get(extension.id)?.enabled ??
        extension.defaultEnabled ??
        false) &&
      Boolean(extension.settings?.sections?.length),
  );
  // Only queried when some enabled extension actually has a folder field.
  const needsFolders = configurableExtensions.some((extension) =>
    extension.settings?.sections?.some((section) =>
      section.fields.some((field) => field.type === "folder"),
    ),
  );
  const folderOptions = needsFolders
    ? await listOwnedFolderOptionsForUser(profile.id)
    : [];

  const corePages: SettingsPage[] = [
    {
      id: "account",
      label: "Account",
      description: "Profile, OAuth providers, and sign out.",
      group: "core",
      icon: "account",
      content: (
        <AccountSettingsSection
          profile={{
            email: profile.email,
            image: profile.image,
            nickname: profile.nickname,
            username: profile.username,
          }}
          connectedProviders={connectedProviders}
          connected={input.accountNotice?.connected}
          error={input.accountNotice?.error}
          saved={input.accountNotice?.saved}
        />
      ),
    },
    {
      id: "workspace",
      label: "Workspace",
      description: "Tabs, panels, and app behavior.",
      group: "core",
      icon: "workspace",
      content: <WorkspaceSettingsSection preferences={preferences.workspace} />,
    },
    {
      id: "editor",
      label: "Editor",
      description: "Markdown editing defaults.",
      group: "core",
      icon: "editor",
      content: <EditorSettingsSection preferences={preferences.editor} />,
    },
    {
      id: "appearance",
      label: "Appearance",
      description: "Themes, fonts, and document presentation.",
      group: "core",
      icon: "appearance",
      content: <AppearanceSettingsSection preferences={preferences.appearance} />,
    },
    {
      id: "snippets",
      label: "Snippets",
      description: "Author CSS snippets to style your documents.",
      group: "core",
      icon: "snippets",
      content: (
        <SnippetsSettingsSection
          initialSnippets={snippetList}
          initialApplyAuthorStyling={applyAuthorStyling}
        />
      ),
    },
    {
      id: "files-assets",
      label: "Files & assets",
      description: "Uploads, embeds, and asset defaults.",
      group: "core",
      icon: "files-assets",
      content: <FilesAssetsSettingsSection preferences={preferences.filesAssets} />,
    },
    {
      id: "hotkeys",
      label: "Hotkeys",
      description: "Commands and shortcut conflicts.",
      group: "core",
      icon: "hotkeys",
      content: <HotkeysSettingsSection preferences={preferences.hotkeys} />,
    },
    {
      id: "core-features",
      label: "Core features",
      description: "Built-in editor and workspace capabilities.",
      group: "core",
      icon: "core-features",
      content: (
        <div className="grid gap-4">
          <CoreFeaturesSettingsSection preferences={preferences.coreFeatures} />
          <CoreCommandsSettingsSection />
        </div>
      ),
    },
    {
      id: "advanced",
      label: "Advanced",
      description: "Diagnostics and reset controls.",
      group: "core",
      icon: "advanced",
      content: <AdvancedSettingsSection preferences={preferences.advanced} />,
    },
  ];

  const extensionPages: SettingsPage[] = [
    {
      id: "extensions",
      label: "Extensions",
      description: "Built-in extensions. Turn them on or off.",
      group: "extensions",
      content: (
        <ExtensionBrowserSection
          extensions={localBuiltInExtensions}
          userSettings={userExtensionSettings}
        />
      ),
    },
    ...configurableExtensions.map((extension): SettingsPage => {
      const defaults = extension.settings?.defaults ?? {};

      return {
        id: extensionSettingsPageId(extension.id),
        label: extension.name,
        description: extension.description ?? "",
        group: "extensions",
        content: (
          <ExtensionSettingsPage
            extensionId={extension.id}
            version={extension.version}
            sections={extension.settings?.sections ?? []}
            defaults={defaults}
            values={{
              ...defaults,
              ...(storedByExtension.get(extension.id)?.settings ?? {}),
            }}
            folderOptions={folderOptions}
          />
        ),
      };
    }),
  ];

  return [...corePages, ...extensionPages];
}
