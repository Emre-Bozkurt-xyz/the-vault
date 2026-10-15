import type { ExtensionSettingsSection } from "@/lib/extension-api";
import type { Preferences } from "@/lib/settings/preferences";
import type { SnippetSummary } from "@/server/snippets";

/**
 * What one extension's card on the Extensions page shows. Derived on the
 * server from the manifest and server module, which do not cross to the client.
 */
export type ExtensionCard = {
  id: string;
  name: string;
  version: number | string;
  description: string | null;
  category: string | null;
  permissions: string[];
  contributionLabels: string[];
  enabled: boolean;
  hasSettings: boolean;
};

/**
 * Everything the settings modal renders, as plain data (`loadSettingsData` on
 * the server, `buildSettingsPagesFromData` on the client).
 */
export type SettingsData = {
  profile: {
    email: string | null;
    image: string | null;
    nickname: string | null;
    username: string | null;
  };
  connectedProviders: { github: boolean; google: boolean };
  accountNotice: { connected?: string; error?: string; saved?: string };
  preferences: Preferences;
  snippets: { list: SnippetSummary[]; applyAuthorStyling: boolean };
  extensionCards: ExtensionCard[];
  extensionPages: Array<{
    id: string;
    name: string;
    description: string;
    version: number;
    sections: readonly ExtensionSettingsSection[];
    defaults: Record<string, unknown>;
    values: Record<string, unknown>;
  }>;
  folderOptions: Array<{ id: string; path: string }>;
  documentOptions: Array<{ id: string; title: string }>;
};
