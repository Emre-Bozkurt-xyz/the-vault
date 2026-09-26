import type { ClientExtensionEntry } from "@/extensions/registry.client";
import type { EditorModule } from "@/lib/extension-api";

export type EditorModuleRequest = {
  extensionId: string;
  load: () => Promise<{ default: EditorModule }>;
};

/**
 * Editor modules still to load (`docs/23_EXTENSION_SDK_PLAN.md` §9): one per
 * enabled extension that has one, loaded when the workspace opens and kept for
 * the session. Authoring code follows enablement only, never content. (Render
 * modules are light and always present; their components load lazily per block
 * through `ExtensionBlockHost`.)
 *
 * `requested` holds extension ids already started, so repeated calls never
 * start a second import of the same module.
 */
export function selectEditorModulesToLoad(
  entries: readonly ClientExtensionEntry[],
  enabledIds: Iterable<string>,
  requested: ReadonlySet<string>,
): EditorModuleRequest[] {
  const enabled = new Set(enabledIds);

  return entries.flatMap((entry) => {
    const id = entry.manifest.id;
    return entry.editor && enabled.has(id) && !requested.has(id)
      ? [{ extensionId: id, load: entry.editor }]
      : [];
  });
}
