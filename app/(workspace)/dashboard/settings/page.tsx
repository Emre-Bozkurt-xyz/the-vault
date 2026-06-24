import { redirect } from "next/navigation";

import { auth } from "@/auth";
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
import { SettingsModal } from "@/components/settings/SettingsModal";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { localBuiltInExtensions, getLocalExtensionIds } from "@/lib/extensions/catalog";
import { buildPreferences } from "@/lib/settings/preferences";
import {
  listConnectedAuthProviders,
  requireCompletedProfile,
} from "@/server/profile";
import { listUserExtensionSettings, listUserSettings } from "@/server/user-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; saved?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const [connectedProviders, userExtensionSettings, userSettings] = await Promise.all([
    listConnectedAuthProviders(),
    listUserExtensionSettings({
      userId: profile.id,
      allowedExtensionIds: getLocalExtensionIds(),
    }),
    listUserSettings({ userId: profile.id }),
  ]);
  const preferences = buildPreferences(userSettings);
  const { connected, error, saved } = await searchParams;

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "settings", title: "Settings", href: "/dashboard/settings" }}
      />
      <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center text-sm text-muted-foreground">
        Settings are open.
      </div>
      <SettingsModal
        accountSection={
          <AccountSettingsSection
            profile={{
              email: profile.email,
              image: profile.image,
              nickname: profile.nickname,
              username: profile.username,
            }}
            connectedProviders={connectedProviders}
            connected={connected}
            error={error}
            saved={saved}
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
        closeHref="/workspace"
      />
    </>
  );
}
