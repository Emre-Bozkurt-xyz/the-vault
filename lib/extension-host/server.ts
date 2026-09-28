import "server-only";

import {
  serverExtensions,
  type ServerExtensionEntry,
} from "@/extensions/registry.server";
import type { ExtensionManifest } from "@/lib/extension-api";
import type { VaultExtensionAgentAction } from "@/lib/extensions/types";

/**
 * Full view of the installed extensions: manifest plus server module, including
 * agent action handlers (`docs/23_EXTENSION_SDK_PLAN.md` §8). Server-only: this
 * is what keeps handler code out of the client bundle. Ordered by id.
 */
export const serverExtensionEntries: readonly ServerExtensionEntry[] = [
  ...serverExtensions,
].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

/** One agent action with the extension that declares it. */
export type AgentActionEntry = {
  action: VaultExtensionAgentAction;
  extension: ExtensionManifest;
};

/**
 * Throws on an action that would escape its extension: a duplicate or
 * un-namespaced id, or a permission the manifest does not grant. Checked at
 * module load, so a malformed extension fails fast rather than at dispatch.
 */
export function assertAgentActionInvariants(
  entries: readonly ServerExtensionEntry[],
): void {
  const seen = new Set<string>();

  for (const { manifest, server } of entries) {
    if (server && server.manifestId !== manifest.id) {
      throw new Error(
        `Server module for "${server.manifestId}" is registered under "${manifest.id}".`,
      );
    }

    const granted = new Set(manifest.permissions);

    for (const action of server?.actions ?? []) {
      if (seen.has(action.id)) {
        throw new Error(`Duplicate agent action id: ${action.id}`);
      }
      seen.add(action.id);

      if (!action.id.startsWith(`${manifest.id}.`)) {
        throw new Error(
          `Agent action "${action.id}" must be namespaced under extension "${manifest.id}".`,
        );
      }

      for (const permission of action.permissions ?? []) {
        if (!granted.has(permission)) {
          throw new Error(
            `Agent action "${action.id}" requests permission "${permission}" not granted to extension "${manifest.id}".`,
          );
        }
      }
    }
  }
}

assertAgentActionInvariants(serverExtensionEntries);

const agentActions: readonly AgentActionEntry[] = serverExtensionEntries.flatMap(
  ({ manifest, server }) =>
    (server?.actions ?? []).map((action) => ({ action, extension: manifest })),
);

/** Every installed extension's actions (agent and UI-only alike). */
export function listAgentActions(): readonly AgentActionEntry[] {
  return agentActions;
}

export function findAgentAction(actionId: string): AgentActionEntry | null {
  return agentActions.find((entry) => entry.action.id === actionId) ?? null;
}
