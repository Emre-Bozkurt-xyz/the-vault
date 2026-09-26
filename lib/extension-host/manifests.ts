import { extensionManifests } from "@/extensions/manifests";
import { toVaultExtension } from "@/lib/extension-host/compat";
import { createVaultExtensionRegistry } from "@/lib/extensions/registry";

/**
 * Manifest-only view of the installed extensions: safe to import from client
 * code because it carries no server modules (agent handlers stay in
 * `lib/extension-host/server.ts`). Replaced the client uses of the old
 * `lib/extensions/catalog.ts`.
 */
export const manifestExtensions = extensionManifests.map((manifest) =>
  toVaultExtension(manifest),
);

export const manifestRegistry = createVaultExtensionRegistry(manifestExtensions);

/** Ids of every installed extension, in registry order. */
export function getInstalledExtensionIds(): string[] {
  return manifestRegistry.getExtensions().map((extension) => extension.id);
}
