/**
 * Test helpers of the extension SDK (`docs/23_EXTENSION_SDK_PLAN.md` §18.4).
 * An extension tests itself with these and no app mocks: a render context,
 * and editor commands run against a bare CodeMirror state.
 */
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";

import type {
  EditorHandle,
  EditorModule,
  ExtensionManifest,
  ExtensionRenderContext,
  JsonValue,
  PickedAsset,
  WikiLinkInfo,
} from "@/lib/extension-api";
import { createEditorHandle } from "@/lib/extension-host/editor-handle";

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
 * resulting Markdown, the cursor, and the session events it emitted. `|` in
 * `markdown` marks the cursor (or two for a selection); without one the cursor
 * is at the end. `pickAsset` answers the command's asset picker (null by
 * default, as if dismissed). Errors propagate to the test.
 */
export async function runCommand(
  editor: EditorModule,
  commandId: string,
  markdown: string,
  options: {
    settings?: Record<string, unknown>;
    folderId?: string | null;
    args?: JsonValue;
    pickAsset?: (request: Parameters<EditorHandle["pickAsset"]>[0]) => PickedAsset | null;
    /** What a dialog the command opens closes with (null, as if dismissed, by default). */
    dialogResult?: (id: string, props: JsonValue | undefined) => JsonValue | null;
  } = {},
): Promise<{
  markdown: string;
  cursor: number;
  events: Array<{ name: string; payload: JsonValue | undefined }>;
  dialogs: Array<{ id: string; props: JsonValue | undefined }>;
  linkCompletions: Array<{ filter: ((link: WikiLinkInfo) => boolean) | null }>;
  openedDocuments: Array<{ documentId: string; title: string }>;
}> {
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

  const events: Array<{ name: string; payload: JsonValue | undefined }> = [];
  const dialogs: Array<{ id: string; props: JsonValue | undefined }> = [];
  const linkCompletions: Array<{ filter: ((link: WikiLinkInfo) => boolean) | null }> = [];
  const openedDocuments: Array<{ documentId: string; title: string }> = [];
  const pickAsset = options.pickAsset;
  await handler(
    createEditorHandle(
      view,
      {
        pickAsset: pickAsset ? async (request) => pickAsset(request) : undefined,
        openDialog: async (_extensionId, id, props) => {
          dialogs.push({ id, props });
          return options.dialogResult?.(id, props) ?? null;
        },
        openLinkCompletion: (_view, completion) => {
          linkCompletions.push({ filter: completion?.filter ?? null });
        },
        openDocument: (documentId, title) => openedDocuments.push({ documentId, title }),
      },
      editor.manifestId,
    ),
    {
      extensionId: editor.manifestId,
      documentId: null,
      folderId: options.folderId ?? null,
      settings: options.settings ?? {},
      args: options.args,
      emit: (name, payload) => events.push({ name, payload }),
    },
  );

  return {
    markdown: state.doc.toString(),
    cursor: state.selection.main.head,
    events,
    dialogs,
    linkCompletions,
    openedDocuments,
  };
}
