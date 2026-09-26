import "server-only";

import { serverExtensions } from "@/extensions/registry.server";
import { toVaultExtension } from "@/lib/extension-host/compat";
import { createVaultExtensionRegistry } from "@/lib/extensions/registry";

/**
 * Full view of the installed extensions (manifests + server modules, including
 * agent action handlers). Server-only: this is what keeps handler code out of
 * the client bundle.
 */
/** Manifest + server module per installed extension, for the runtime. */
export const serverExtensionEntries = serverExtensions;

export const installedExtensions = serverExtensions.map(({ manifest, server }) =>
  toVaultExtension(manifest, server),
);

export const extensionRegistry = createVaultExtensionRegistry(installedExtensions);
