"use client";

import { useEffect, useState, type ReactNode } from "react";

import { SettingsModal } from "@/components/settings/SettingsModal";

type SettingsSectionId =
  | "account"
  | "workspace"
  | "editor"
  | "appearance"
  | "files-assets"
  | "hotkeys"
  | "core-features"
  | "extension-browser"
  | "installed-extensions"
  | "advanced";

export const openSettingsEventName = "vault:open-settings";

export type OpenSettingsEventDetail = {
  section?: SettingsSectionId;
};

type SettingsModalControllerProps = {
  accountSection: ReactNode;
  workspaceSection?: ReactNode;
  editorSection?: ReactNode;
  appearanceSection?: ReactNode;
  filesAssetsSection?: ReactNode;
  hotkeysSection?: ReactNode;
  coreFeaturesSection?: ReactNode;
  extensionBrowserSection?: ReactNode;
  installedExtensionsSection?: ReactNode;
  advancedSection?: ReactNode;
};

export function SettingsModalController({
  accountSection,
  workspaceSection,
  editorSection,
  appearanceSection,
  filesAssetsSection,
  hotkeysSection,
  coreFeaturesSection,
  extensionBrowserSection,
  installedExtensionsSection,
  advancedSection,
}: SettingsModalControllerProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("account");

  useEffect(() => {
    function onOpenSettings(event: Event) {
      const detail = (event as CustomEvent<OpenSettingsEventDetail>).detail;

      setSection(isSettingsSection(detail?.section) ? detail.section : "account");
      setOpen(true);
    }

    window.addEventListener(openSettingsEventName, onOpenSettings);

    return () => {
      window.removeEventListener(openSettingsEventName, onOpenSettings);
    };
  }, []);

  return (
    <SettingsModal
      accountSection={accountSection}
      workspaceSection={workspaceSection}
      editorSection={editorSection}
      appearanceSection={appearanceSection}
      filesAssetsSection={filesAssetsSection}
      hotkeysSection={hotkeysSection}
      coreFeaturesSection={coreFeaturesSection}
      extensionBrowserSection={extensionBrowserSection}
      installedExtensionsSection={installedExtensionsSection}
      advancedSection={advancedSection}
      defaultSection={section}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

export function openWorkspaceSettings(section?: SettingsSectionId) {
  window.dispatchEvent(
    new CustomEvent<OpenSettingsEventDetail>(openSettingsEventName, {
      detail: { section },
    }),
  );
}

function isSettingsSection(value: unknown): value is SettingsSectionId {
  return (
    value === "account" ||
    value === "workspace" ||
    value === "editor" ||
    value === "appearance" ||
    value === "files-assets" ||
    value === "hotkeys" ||
    value === "core-features" ||
    value === "extension-browser" ||
    value === "installed-extensions" ||
    value === "advanced"
  );
}
