import type { ExtensionManifest } from "@/lib/extension-api";
import type { ExtensionServerModule } from "@/lib/extension-api/server";
import type { VaultExtension } from "@/lib/extensions/types";

/**
 * Adapts an SDK manifest (plus, on the server, its server module) to the
 * registry's `VaultExtension` shape, so `createVaultExtensionRegistry` and its
 * consumers keep working while the host is built out
 * (`docs/23_EXTENSION_SDK_PLAN.md` slice 1). Goes away once consumers read
 * manifests and host contributions directly.
 */
export function toVaultExtension(
  manifest: ExtensionManifest,
  server: ExtensionServerModule | null = null,
): VaultExtension {
  if (server && server.manifestId !== manifest.id) {
    throw new Error(
      `Server module for "${server.manifestId}" is registered under "${manifest.id}".`,
    );
  }

  const stateSchemas = (server?.state ?? []).map((declaration) => ({
    extensionId: manifest.id,
    ...(declaration.key ? { stateKey: declaration.key } : {}),
    version: declaration.version,
    schema: declaration.schema,
  }));

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    kind: "built-in",
    description: manifest.description,
    category: manifest.category,
    permissions: [...manifest.permissions],
    defaultEnabled: manifest.defaultEnabled,
    ...(manifest.settings
      ? {
          settings: {
            schema: manifest.settings.schema,
            defaults: manifest.settings.defaults,
            sections: manifest.settings.sections
              ? [...manifest.settings.sections]
              : undefined,
          },
        }
      : {}),
    ...(manifest.slashCommands?.length
      ? { markdown: { slashCommands: [...manifest.slashCommands] } }
      : {}),
    ...(stateSchemas.length || manifest.overlays?.length
      ? {
          documentState: {
            schemas: stateSchemas,
            ...(manifest.overlays?.length
              ? { overlays: [...manifest.overlays] }
              : {}),
          },
        }
      : {}),
    ...(manifest.commands?.length
      ? { workspace: { commands: [...manifest.commands] } }
      : {}),
    ...(server?.actions.length
      ? { agent: { actions: [...server.actions] } }
      : {}),
  };
}
