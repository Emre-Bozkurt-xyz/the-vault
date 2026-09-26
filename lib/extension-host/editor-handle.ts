import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

import type {
  CommandHandler,
  EditorCommandContext,
  EditorHandle,
} from "@/lib/extension-api";

/**
 * The parts of a CodeMirror view the editor handle needs. A real `EditorView`
 * satisfies it; tests pass a bare state plus `dispatch`.
 */
export type EditorViewLike = {
  readonly state: EditorState;
  dispatch: (transaction: TransactionSpec) => void;
  focus?: () => void;
};

/**
 * Inserts text as its own block at the cursor, replacing any selection and
 * breaking the paragraph when the cursor is mid-line. `cursorOffset` is where
 * the cursor lands within `text` (after it when null).
 */
export function insertBlock(
  view: EditorViewLike,
  text: string,
  cursorOffset: number | null,
) {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const needsLeadingBreak = selection.from > line.from;
  const insert = `${needsLeadingBreak ? "\n\n" : ""}${text}\n`;
  const cursorPosition =
    cursorOffset === null
      ? selection.from + insert.length
      : selection.from + (needsLeadingBreak ? 2 : 0) + cursorOffset;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(cursorPosition),
    scrollIntoView: true,
  });
  view.focus?.();
}

/**
 * Drops text at the cursor without disturbing the paragraph, replacing any
 * selection. The mid-sentence counterpart to `insertBlock`: an inline
 * `:calc[…]` typed after "The total is " must not become its own block.
 */
export function insertInline(
  view: EditorViewLike,
  text: string,
  cursorOffset: number | null,
) {
  const selection = view.state.selection.main;
  const cursorPosition =
    selection.from + (cursorOffset === null ? text.length : cursorOffset);

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: EditorSelection.cursor(cursorPosition),
    scrollIntoView: true,
  });
  view.focus?.();
}

/** The {@link EditorHandle} an extension command receives, over one view. */
export function createEditorHandle(view: EditorViewLike): EditorHandle {
  return {
    insertBlock: (markdown, options) =>
      insertBlock(view, markdown, options?.cursorOffset ?? null),
    insertInline: (markdown, options) =>
      insertInline(view, markdown, options?.cursorOffset ?? null),
    selection: () => {
      const { from, to } = view.state.selection.main;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
  };
}

/**
 * Runs an extension command against a view. A command that throws is logged
 * and swallowed: a broken extension must never take the editor down
 * (`docs/23_EXTENSION_SDK_PLAN.md` §18.5).
 */
export function runExtensionCommand(
  handler: CommandHandler,
  view: EditorViewLike,
  context: EditorCommandContext,
): void {
  const report = (cause: unknown) =>
    console.error(`Extension command from "${context.extensionId}" failed`, cause);

  try {
    const result = handler(createEditorHandle(view), context);
    if (result instanceof Promise) result.catch(report);
  } catch (cause) {
    report(cause);
  }
}
