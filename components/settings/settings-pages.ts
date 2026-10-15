import type { ReactNode } from "react";

/**
 * One page of the settings modal.
 *
 * Pages are built on the client (`buildSettingsPagesFromData`) from plain data
 * the server gathers (`loadSettingsData`), and the modal renders whatever it is
 * given instead of carrying a prop per page — which is what lets every enabled
 * extension with settings get a page of its own.
 *
 * `icon` is a key rather than a component because icons are functions and do not
 * cross the server/client boundary; the modal resolves the key.
 */
export type SettingsPage = {
  id: string;
  label: string;
  /** One muted line under the page title. Never shown in the sidebar. */
  description: string;
  group: "core" | "extensions";
  icon?: SettingsIconKey;
  content: ReactNode;
};

export type SettingsIconKey =
  | "account"
  | "workspace"
  | "editor"
  | "appearance"
  | "snippets"
  | "files-assets"
  | "hotkeys"
  | "core-features"
  | "extensions"
  | "advanced";

export function extensionSettingsPageId(extensionId: string) {
  return `extension:${extensionId}`;
}
