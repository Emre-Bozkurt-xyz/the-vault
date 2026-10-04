import { EditorSelection, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import type { EditorJump } from "@/lib/editor-jump-events";

/**
 * Resolves a jump target to a 1-based CodeMirror line number: the recorded line
 * if it still holds the recorded text, else the only line that does, else the
 * recorded line clamped into the document (the text was edited since it was
 * indexed, and the old position is the best remaining guess).
 */
export function resolveJumpLine(doc: Text, jump: EditorJump): number {
  const recorded = Math.min(Math.max(jump.line + 1, 1), doc.lines);

  if (jump.text === undefined || doc.line(recorded).text === jump.text) {
    return recorded;
  }

  let match = 0;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    if (doc.line(lineNumber).text === jump.text) {
      if (match) {
        return recorded; // Ambiguous: two identical lines.
      }
      match = lineNumber;
    }
  }

  return match || recorded;
}

const flashDuration = 1600;
const setFlash = StateEffect.define<number | null>();
const flashLine = Decoration.line({ class: "vault-cm-jump-flash" });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setFlash)) {
        next =
          effect.value === null
            ? Decoration.none
            : Decoration.set([flashLine.range(effect.value)]);
      }
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Scrolls the jump target to the middle of the viewport, puts the cursor at the
 * end of its line, and briefly highlights it. The highlight field is appended
 * to the view's configuration on first use rather than threaded through the
 * editor's extension list; if a later reconfigure drops it, the next jump adds
 * it again.
 */
export function applyEditorJump(view: EditorView, jump: EditorJump) {
  // A field added by `appendConfig` only sees effects from later transactions,
  // so it is installed on its own before the flash is set.
  if (view.state.field(flashField, false) === undefined) {
    view.dispatch({ effects: StateEffect.appendConfig.of(flashField) });
  }

  const line = view.state.doc.line(resolveJumpLine(view.state.doc, jump));

  view.dispatch({
    selection: EditorSelection.cursor(line.to),
    effects: [
      EditorView.scrollIntoView(line.from, { y: "center" }),
      setFlash.of(line.from),
    ],
  });
  view.focus();

  window.setTimeout(() => {
    if (view.dom.isConnected && view.state.field(flashField, false) !== undefined) {
      view.dispatch({ effects: setFlash.of(null) });
    }
  }, flashDuration);
}
