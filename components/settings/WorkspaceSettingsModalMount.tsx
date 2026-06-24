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
import {
  getLocalExtensionIds,
  localBuiltInExtensions,
} from "@/lib/extensions/catalog";
import { listConnectedAuthProviders } from "@/server/profile";
import {
  listUserExtensionSettings,
  listUserSettings,
} from "@/server/user-settings";

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
  const [connectedProviders, userExtensionSettings, userSettings] =
    await Promise.all([
      listConnectedAuthProviders(),
      listUserExtensionSettings({
        userId: profile.id,
        allowedExtensionIds: getLocalExtensionIds(),
      }),
      listUserSettings({ userId: profile.id }),
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
