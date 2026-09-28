import { extensionManifests } from "@/extensions/manifests";
import type {
  ExtensionManifest,
  SlashCommandContribution,
} from "@/lib/extension-api";

/**
 * The installed extensions' manifests, for code that needs what extensions
 * *are* rather than what they do (`docs/23_EXTENSION_SDK_PLAN.md` §5): settings
 * schemas, slash items, ids. Client-safe: manifests carry no server code (agent
 * handlers stay in `lib/extension-host/server.ts`). Ordered by id.
 */
export const installedManifests: readonly ExtensionManifest[] = [...extensionManifests].sort(
  (a, b) => a.id.localeCompare(b.id),
);

const byId = new Map(installedManifests.map((manifest) => [manifest.id, manifest]));

/** Ids of every installed extension, in id order. */
export function getInstalledExtensionIds(): string[] {
  return installedManifests.map((manifest) => manifest.id);
}

export function getExtensionManifest(extensionId: string): ExtensionManifest | null {
  return byId.get(extensionId) ?? null;
}

/** A slash item with the extension that contributes it. */
export type SlashCommandContributionEntry = SlashCommandContribution & {
  sourceExtensionId: string;
  sourceExtensionName: string;
};

/** Every installed extension's slash items; the editor filters by enablement. */
export function getSlashCommandContributions(): SlashCommandContributionEntry[] {
  return installedManifests.flatMap((manifest) =>
    (manifest.slashCommands ?? []).map((contribution) => ({
      ...contribution,
      sourceExtensionId: manifest.id,
      sourceExtensionName: manifest.name,
    })),
  );
}
