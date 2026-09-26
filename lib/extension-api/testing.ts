/**
 * Test helpers of the extension SDK (`docs/23_EXTENSION_SDK_PLAN.md` §18.4).
 * An extension tests itself with these and no app mocks: a render context,
 * and editor commands run against a bare CodeMirror state.
 */
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";

import type {
  EditorModule,
  ExtensionManifest,
  ExtensionRenderContext,
} from "@/lib/extension-api";
import { runExtensionCommand } from "@/lib/extension-host/editor-handle";

/**
 * A render context for `manifest`, defaulting to an editable workspace
 * document with the manifest's default settings and no state.
 */
export function createTestContext(
  manifest: ExtensionManifest,
  overrides: Partial<ExtensionRenderContext> = {},
): ExtensionRenderContext {
  const defaults = manifest.settings?.schema.safeParse({});

  return {
    extensionId: manifest.id,
    documentId: "00000000-0000-4000-8000-000000000001",
    surface: "workspace",
    canEdit: true,
    enabled: true,
    settings: defaults?.success ? defaults.data : {},
    state: {},
    data: null,
    ...overrides,
  };
}

/**
 * Runs one of an editor module's commands against `markdown` and returns the
 * resulting Markdown and cursor. `|` in `markdown` marks the cursor (or two for
 * a selection); without one the cursor is at the end.
 */
export async function runCommand(
  editor: EditorModule,
  commandId: string,
  markdown: string,
  options: { settings?: Record<string, unknown> } = {},
): Promise<{ markdown: string; cursor: number }> {
  const handler = editor.commands[commandId];
  if (!handler) {
    throw new Error(`"${editor.manifestId}" has no command "${commandId}".`);
  }

  const marks = [...markdown.matchAll(/\|/g)].map((match, index) => match.index - index);
  const doc = markdown.replace(/\|/g, "");
  const anchor = marks[0] ?? doc.length;
  const head = marks[1] ?? anchor;

  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch: (transaction: TransactionSpec) => {
      state = state.update(transaction).state;
    },
  };

  // Errors surface to the test rather than being logged away.
  let failure: unknown = null;
  const originalError = console.error;
  console.error = (_message: unknown, cause: unknown) => {
    failure = cause;
  };
  try {
    runExtensionCommand(handler, view, {
      extensionId: editor.manifestId,
      documentId: null,
      settings: options.settings ?? {},
    });
    await Promise.resolve();
  } finally {
    console.error = originalError;
  }
  if (failure) throw failure;

  return { markdown: state.doc.toString(), cursor: state.selection.main.head };
}
