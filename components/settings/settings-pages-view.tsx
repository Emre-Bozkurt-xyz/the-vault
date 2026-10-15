"use client";

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
import { SettingsModal } from "@/components/settings/SettingsModal";
import type { SettingsData } from "@/components/settings/settings-data";
import {
  extensionSettingsPageId,
  type SettingsPage,
} from "@/components/settings/settings-pages";
import { SnippetsSettingsSection } from "@/components/settings/SnippetsSettingsSection";

/**
 * Every page of the settings modal, built from `loadSettingsData`'s result.
 *
 * This module holds every section component, so the workspace imports it only
 * when the modal first opens (`SettingsModalController`); `/dashboard/settings`
 * renders it directly through `SettingsModalFromData`.
 */
export function buildSettingsPagesFromData(data: SettingsData): SettingsPage[] {
  const { preferences } = data;
  const corePages: SettingsPage[] = [
    {
      id: "account",
      label: "Account",
      description: "Profile, OAuth providers, and sign out.",
      group: "core",
      icon: "account",
      content: (
        <AccountSettingsSection
          profile={data.profile}
          connectedProviders={data.connectedProviders}
          connected={data.accountNotice.connected}
          error={data.accountNotice.error}
          saved={data.accountNotice.saved}
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
          initialSnippets={data.snippets.list}
          initialApplyAuthorStyling={data.snippets.applyAuthorStyling}
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
      content: <ExtensionBrowserSection extensions={data.extensionCards} />,
    },
    ...data.extensionPages.map(
      (extension): SettingsPage => ({
        id: extensionSettingsPageId(extension.id),
        label: extension.name,
        description: extension.description,
        group: "extensions",
        content: (
          <ExtensionSettingsPage
            extensionId={extension.id}
            version={extension.version}
            sections={extension.sections}
            defaults={extension.defaults}
            values={extension.values}
            folderOptions={data.folderOptions}
            documentOptions={data.documentOptions}
          />
        ),
      }),
    ),
  ];

  return [...corePages, ...extensionPages];
}

/** `/dashboard/settings`: the modal over a server-loaded `SettingsData`. */
export function SettingsModalFromData({
  data,
  defaultPageId,
  closeHref,
}: {
  data: SettingsData;
  defaultPageId?: string;
  closeHref?: string;
}) {
  return (
    <SettingsModal
      pages={buildSettingsPagesFromData(data)}
      defaultPageId={defaultPageId}
      closeHref={closeHref}
    />
  );
}
