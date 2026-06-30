import type {
  CommandContribution,
  DocumentOverlayContribution,
  ExtensionStateSchema,
  LiveBlockInstance,
  LiveBlockSpec,
  MarkdownPreprocessor,
  VaultExtension,
  VaultExtensionAgentAction,
  WorkspacePageContribution,
  WorkspacePanelContribution,
} from "@/lib/extensions/types";

export type AgentActionEntry = {
  action: VaultExtensionAgentAction;
  extension: VaultExtension;
};

export type VaultExtensionRegistry = {
  extensions: VaultExtension[];
  getExtensions: () => VaultExtension[];
  getEnabledExtensions: (enabledExtensionIds: Iterable<string>) => VaultExtension[];
  getExtension: (extensionId: string) => VaultExtension | null;
  getExtensionSettingsSchema: (
    extensionId: string,
  ) => VaultExtension["settings"] | null;
  getMarkdownLiveBlockSpecs: () => LiveBlockSpec<LiveBlockInstance>[];
  getMarkdownPreprocessors: () => MarkdownPreprocessor[];
  getDocumentStateSchemas: () => ExtensionStateSchema[];
  getDocumentStateSchema: (
    extensionId: string,
    stateKey?: string,
  ) => ExtensionStateSchema | null;
  getDocumentOverlayContributions: () => Array<
    DocumentOverlayContribution & { sourceExtensionId: string }
  >;
  getWorkspacePageContributions: () => Array<
    WorkspacePageContribution & { sourceExtensionId: string }
  >;
  getWorkspacePanelContributions: () => Array<
    WorkspacePanelContribution & { sourceExtensionId: string }
  >;
  getCommandContributions: () => Array<
    CommandContribution & { sourceExtensionId: string }
  >;
  getAgentActions: () => AgentActionEntry[];
  getAgentAction: (actionId: string) => AgentActionEntry | null;
};

/**
 * Asserts the manifest invariants agent actions rely on: every action id is
 * namespaced under its extension, ids are globally unique, and an action never
 * requests a permission its extension hasn't declared. Throws at module load so
 * a malformed manifest fails fast rather than at dispatch time.
 */
function assertAgentActionInvariants(extensions: VaultExtension[]): void {
  const seen = new Set<string>();

  for (const extension of extensions) {
    const granted = new Set(extension.permissions ?? []);

    for (const action of extension.agent?.actions ?? []) {
      if (seen.has(action.id)) {
        throw new Error(`Duplicate agent action id: ${action.id}`);
      }
      seen.add(action.id);

      if (
        action.id !== extension.id &&
        !action.id.startsWith(`${extension.id}.`)
      ) {
        throw new Error(
          `Agent action "${action.id}" must be namespaced under extension "${extension.id}".`,
        );
      }

      for (const permission of action.permissions ?? []) {
        if (!granted.has(permission)) {
          throw new Error(
            `Agent action "${action.id}" requests permission "${permission}" not granted to extension "${extension.id}".`,
          );
        }
      }
    }
  }
}

export function createVaultExtensionRegistry(
  extensions: VaultExtension[],
): VaultExtensionRegistry {
  const orderedExtensions = [...extensions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  assertAgentActionInvariants(orderedExtensions);

  return {
    extensions: orderedExtensions,
    getExtensions() {
      return orderedExtensions;
    },
    getEnabledExtensions(enabledExtensionIds) {
      const enabled = new Set(enabledExtensionIds);

      return orderedExtensions.filter(
        (extension) => extension.kind === "core" || enabled.has(extension.id),
      );
    },
    getExtension(extensionId) {
      return (
        orderedExtensions.find((extension) => extension.id === extensionId) ??
        null
      );
    },
    getExtensionSettingsSchema(extensionId) {
      return (
        orderedExtensions.find((extension) => extension.id === extensionId)
          ?.settings ?? null
      );
    },
    getMarkdownLiveBlockSpecs() {
      return orderedExtensions.flatMap(
        (extension) => extension.markdown?.liveBlocks ?? [],
      ) as LiveBlockSpec<LiveBlockInstance>[];
    },
    getMarkdownPreprocessors() {
      return orderedExtensions.flatMap(
        (extension) => extension.markdown?.preprocessors ?? [],
      );
    },
    getDocumentStateSchemas() {
      return orderedExtensions.flatMap(
        (extension) => extension.documentState?.schemas ?? [],
      );
    },
    getDocumentStateSchema(extensionId, stateKey) {
      return (
        orderedExtensions
          .flatMap((extension) => extension.documentState?.schemas ?? [])
          .find(
            (schema) =>
              schema.extensionId === extensionId &&
              (schema.stateKey ?? "default") === (stateKey ?? "default"),
          ) ?? null
      );
    },
    getDocumentOverlayContributions() {
      return orderedExtensions.flatMap((extension) =>
        (extension.documentState?.overlays ?? []).map((contribution) => ({
          ...contribution,
          sourceExtensionId: extension.id,
        })),
      );
    },
    getWorkspacePageContributions() {
      return orderedExtensions.flatMap((extension) =>
        (extension.workspace?.pages ?? []).map((contribution) => ({
          ...contribution,
          sourceExtensionId: extension.id,
        })),
      );
    },
    getWorkspacePanelContributions() {
      return orderedExtensions.flatMap((extension) =>
        (extension.workspace?.panels ?? []).map((contribution) => ({
          ...contribution,
          sourceExtensionId: extension.id,
        })),
      );
    },
    getCommandContributions() {
      return orderedExtensions.flatMap((extension) =>
        (extension.workspace?.commands ?? []).map((contribution) => ({
          ...contribution,
          sourceExtensionId: extension.id,
        })),
      );
    },
    getAgentActions() {
      return orderedExtensions.flatMap((extension) =>
        (extension.agent?.actions ?? []).map((action) => ({
          action,
          extension,
        })),
      );
    },
    getAgentAction(actionId) {
      for (const extension of orderedExtensions) {
        const action = extension.agent?.actions?.find(
          (candidate) => candidate.id === actionId,
        );
        if (action) {
          return { action, extension };
        }
      }
      return null;
    },
  };
}
