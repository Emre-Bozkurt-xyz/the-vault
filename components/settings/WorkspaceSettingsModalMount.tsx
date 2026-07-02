import { AccountSettingsSection } from "@/components/settings/AccountSettingsSection";
import { ExtensionBrowserSection } from "@/components/settings/ExtensionBrowserSection";
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
import { buildPreferences } from "@/lib/settings/preferences";
import { SettingsModalController } from "@/components/settings/SettingsModalController";
import { SnippetsSettingsSection } from "@/components/settings/SnippetsSettingsSection";
import {
  getLocalExtensionIds,
  localBuiltInExtensions,
} from "@/lib/extensions/catalog";
import { listConnectedAuthProviders } from "@/server/profile";
import {
  listUserExtensionSettings,
  listUserSettings,
} from "@/server/user-settings";
import {
  getViewerStylingPreference,
  listSnippetsForUser,
} from "@/server/snippets";

type WorkspaceSettingsModalMountProps = {
  profile: {
    id: string;
    email: string | null;
    image: string | null;
    nickname: string | null;
    username: string | null;
  };
};

export async function WorkspaceSettingsModalMount({
  profile,
}: WorkspaceSettingsModalMountProps) {
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

  return (
    <SettingsModalController
      accountSection={
        <AccountSettingsSection
          profile={{
            email: profile.email,
            image: profile.image,
            nickname: profile.nickname,
            username: profile.username,
          }}
          connectedProviders={connectedProviders}
        />
      }
      workspaceSection={
        <WorkspaceSettingsSection preferences={preferences.workspace} />
      }
      editorSection={<EditorSettingsSection preferences={preferences.editor} />}
      appearanceSection={
        <AppearanceSettingsSection preferences={preferences.appearance} />
      }
      snippetsSection={
        <SnippetsSettingsSection
          initialSnippets={snippetList}
          initialApplyAuthorStyling={applyAuthorStyling}
        />
      }
      filesAssetsSection={
        <FilesAssetsSettingsSection preferences={preferences.filesAssets} />
      }
      hotkeysSection={<HotkeysSettingsSection preferences={preferences.hotkeys} />}
      coreFeaturesSection={
        <div className="grid gap-4">
          <CoreFeaturesSettingsSection preferences={preferences.coreFeatures} />
          <CoreCommandsSettingsSection />
        </div>
      }
      extensionBrowserSection={
        <ExtensionBrowserSection
          extensions={localBuiltInExtensions}
          userSettings={userExtensionSettings}
        />
      }
      installedExtensionsSection={
        <ExtensionBrowserSection
          extensions={localBuiltInExtensions}
          userSettings={userExtensionSettings}
          mode="installed"
        />
      }
      advancedSection={
        <AdvancedSettingsSection preferences={preferences.advanced} />
      }
    />
  );
}
