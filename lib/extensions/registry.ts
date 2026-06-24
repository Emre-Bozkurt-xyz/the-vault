import type {
  CommandContribution,
  DocumentOverlayContribution,
  ExtensionStateSchema,
  LiveBlockInstance,
  LiveBlockSpec,
  MarkdownPreprocessor,
  VaultExtension,
  WorkspacePageContribution,
  WorkspacePanelContribution,
} from "@/lib/extensions/types";

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
};

export function createVaultExtensionRegistry(
  extensions: VaultExtension[],
): VaultExtensionRegistry {
  const orderedExtensions = [...extensions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

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
  };
}
