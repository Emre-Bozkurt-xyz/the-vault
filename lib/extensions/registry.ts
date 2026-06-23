import type {
  ExtensionStateSchema,
  LiveBlockInstance,
  LiveBlockSpec,
  MarkdownPreprocessor,
  VaultExtension,
} from "@/lib/extensions/types";

export type VaultExtensionRegistry = {
  extensions: VaultExtension[];
  getMarkdownLiveBlockSpecs: () => LiveBlockSpec<LiveBlockInstance>[];
  getMarkdownPreprocessors: () => MarkdownPreprocessor[];
  getDocumentStateSchemas: () => ExtensionStateSchema[];
  getDocumentStateSchema: (
    extensionId: string,
    stateKey?: string,
  ) => ExtensionStateSchema | null;
};

export function createVaultExtensionRegistry(
  extensions: VaultExtension[],
): VaultExtensionRegistry {
  const orderedExtensions = [...extensions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  return {
    extensions: orderedExtensions,
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
  };
}
