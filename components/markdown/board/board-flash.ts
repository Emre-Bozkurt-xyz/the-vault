import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * Board edits flash the lines they wrote in the Source pane beside the board,
 * so the Markdown behind a drag or a keypress is visible as it happens.
 *
 * Only transactions tagged `input.board` (the board's own edits) flash. Which
 * lines count as changed is a line diff of the replaced region, not the
 * replaced range itself: moving a card rewrites every line between its old and
 * new place, but only the card's own lines actually moved.
 */
export const BOARD_USER_EVENT = "input.board";
const FLASH_MS = 1400;
const MAX_DIFF_LINES = 600;

const clearFlash = StateEffect.define<null>();
const flashLine = Decoration.line({ class: "vault-cm-board-flash" });

function lineRange(doc: Text, from: number, to: number) {
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(Math.max(from, to)).number;
  return { first, last };
}

/** 1-based numbers, in the new document, of the lines that aren't in the old one. */
export function changedLines(before: string[], after: string[]): number[] {
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) return [];
  // Longest common subsequence; the new lines outside it are what changed.
  const table: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (j < after.length) {
    if (i < before.length && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (i < before.length && table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      if (after[j].trim()) changed.push(j);
      j += 1;
    }
  }
  return changed;
}

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.effects.some((effect) => effect.is(clearFlash))) return Decoration.none;
    if (!transaction.docChanged) return value;
    if (!transaction.isUserEvent(BOARD_USER_EVENT)) return value.map(transaction.changes);

    const before = transaction.startState.doc;
    const after = transaction.state.doc;
    const numbers: number[] = [];
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const old = lineRange(before, fromA, toA);
      const next = lineRange(after, fromB, toB);
      const oldLines: string[] = [];
      for (let n = old.first; n <= old.last; n += 1) oldLines.push(before.line(n).text);
      const newLines: string[] = [];
      for (let n = next.first; n <= next.last; n += 1) newLines.push(after.line(n).text);
      for (const offset of changedLines(oldLines, newLines)) numbers.push(next.first + offset);
    });

    const builder = new RangeSetBuilder<Decoration>();
    for (const number of [...new Set(numbers)].sort((a, b) => a - b)) {
      const line = after.line(number);
      builder.add(line.from, line.from, flashLine);
    }
    return builder.finish();
  },
  provide: (field) => EditorView.decorations.from(field),
});

const flashClearer = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;

    update(update: ViewUpdate) {
      if (!update.transactions.some((transaction) => transaction.isUserEvent(BOARD_USER_EVENT))) return;
      const flashed = update.view.state.field(flashField);
      if (flashed.size === 0) return;
      const view = update.view;
      const first = flashed.iter().from;
      if (this.timer) clearTimeout(this.timer);
      // Dispatching from inside an update isn't allowed; do it on the next tick.
      setTimeout(() => {
        if (view.dom.isConnected && view.dom.offsetParent) {
          view.dispatch({ effects: EditorView.scrollIntoView(first, { y: "center" }) });
        }
      }, 0);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (view.dom.isConnected) view.dispatch({ effects: clearFlash.of(null) });
      }, FLASH_MS);
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

export function boardFlashExtension(): Extension {
  return [flashField, flashClearer];
}
