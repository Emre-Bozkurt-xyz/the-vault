import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

import type { FxRateTable } from "@/lib/calc/fx";
import {
  calcValueMarkup,
  resolveCalcOccurrences,
  type CalcOccurrence,
  type ResolvedCalc,
} from "@/lib/calc/resolve";
import { scanCalcBlocks, scanInlineCalc } from "@/lib/calc/scan";
import { parseCalcSettings } from "@/lib/calc/settings";
import { parseAttributeString, parseCalcPresentation } from "@/lib/markdown/calc-directive";

/**
 * Live-mode decorations for `:calc`.
 *
 * The existing engine in `live-blocks.ts` is block-only — it replaces whole
 * line ranges with block widgets. Inline values need the other shape:
 * `Decoration.replace` over a mid-paragraph range, with the source revealed the
 * moment the cursor touches it. That gap is why this file exists, and it is the
 * inline contribution point `docs/12_EXTENSION_REGISTRY_PLAN.md` says the
 * registry is missing.
 *
 * ## Consistency with Read mode
 *
 * Occurrences are located by raw-text scan (`lib/calc/scan.ts`) rather than by
 * parsing with remark, because remark on every keystroke is far too expensive.
 * The two locators are held equivalent by `lib/calc/scan.test.ts`, and both then
 * go through the *same* `resolveCalcOccurrences`, so a figure is identical in
 * the editor and on the page.
 *
 * ## Two hazards a block widget carries, and how each is handled here
 *
 * **Margins are invisible to CodeMirror.** A block widget is measured with
 * `getBoundingClientRect()`, which excludes margin, so the `margin: 1rem 0` on
 * the Read-mode `.vault-calc-block` card left the height map 32px short and put
 * *every line below the block in the document* out of step with its own
 * coordinates — clicks landed a line or two off for the rest of the page. The
 * widget therefore renders the card inside a spacing frame that carries the gap
 * as padding, the same rule `applyStableBlockWidgetSpacing` enforces in
 * `live-blocks.ts`. Never put vertical margin on a block widget's root.
 *
 * **A replace widget is opaque to the cursor.** CodeMirror cannot know which
 * source character a pixel inside a widget stands for, so every click resolves
 * to the widget's `from` or `to`. For a callout or table that is tolerable; for
 * a declarations block it means clicking the row you want to edit dumps you at
 * the top or bottom of the block. Because each rendered row corresponds exactly
 * to one statement line, this widget can do better: it remembers which row was
 * pressed and, on mouse *up* with an empty selection — a click, not a drag —
 * moves the cursor to the end of that row's source line. Mouse-up rather than
 * mouse-down so CodeMirror's own selection handling is left completely alone
 * and dragging still works exactly as it did.
 */

export type CalcLiveOptions = {
  fxTable?: FxRateTable | null;
};

/**
 * Which rendered row of a block widget the current press started on.
 *
 * Set on mousedown while the widget DOM is still attached, read on mouseup once
 * CodeMirror has settled the selection. Deliberately module-scoped: a press and
 * its release are one gesture, and there is only ever one at a time.
 */
let pressedRowIndex: number | null = null;

/**
 * A `:::calc` declarations block, rendered as the same definition list Read
 * mode shows. Reveals its source when the cursor enters it, matching how the
 * callout and table live blocks behave — a block that stayed as raw source
 * while inline values beside it showed results read as inconsistent.
 */
class CalcBlockWidget extends WidgetType {
  constructor(
    private readonly rows: ResolvedCalc[],
    private readonly collapsed: boolean,
  ) {
    super();
  }

  eq(other: CalcBlockWidget): boolean {
    return (
      other.collapsed === this.collapsed &&
      other.rows.length === this.rows.length &&
      other.rows.every((row, index) => {
        const mine = this.rows[index];
        return (
          row.value === mine.value &&
          row.label === mine.label &&
          row.state === mine.state
        );
      })
    );
  }

  toDOM(): HTMLElement {
    // The card's own vertical gap lives on this frame as padding, where
    // CodeMirror can measure it. See the header note on margins.
    const frame = document.createElement("div");
    frame.className = "vault-cm-calc-block-frame";

    const root = document.createElement("div");
    root.className = "vault-calc-block vault-cm-calc-block";

    if (this.collapsed) {
      root.dataset.calcCollapsed = "true";
    }

    const body = document.createElement("div");
    body.className = "vault-calc-block-body";

    this.rows.forEach((resolved, index) => {
      const markup = calcValueMarkup(resolved);
      const row = document.createElement("div");
      row.className = "vault-calc-block-row";
      // Recorded, not acted on: acting here would mean pre-empting CodeMirror's
      // mousedown, and with it the drag that starts one.
      row.addEventListener("mousedown", (event) => {
        pressedRowIndex = event.button === 0 ? index : null;
      });

      const value = document.createElement("span");
      value.className = `${markup.rootClassName} vault-cm-calc`;
      value.dataset.calcState = markup.state;
      value.title = markup.title;

      for (const part of markup.parts) {
        const span = document.createElement("span");
        span.className = part.className;
        span.textContent = part.text;

        if (part.decorative) {
          span.setAttribute("aria-hidden", "true");
        }

        value.append(span);
      }

      row.append(value);
      body.append(row);
    });

    root.append(body);
    frame.append(root);
    return frame;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CalcInlineWidget extends WidgetType {
  constructor(private readonly resolved: ResolvedCalc) {
    super();
  }

  /**
   * Compared by rendered content, not identity: an edit elsewhere in the
   * document re-resolves every value, and without this every widget in the
   * document would be torn down and rebuilt on each keystroke.
   */
  eq(other: CalcInlineWidget): boolean {
    return (
      other.resolved.value === this.resolved.value &&
      other.resolved.label === this.resolved.label &&
      other.resolved.state === this.resolved.state &&
      other.resolved.expression === this.resolved.expression &&
      other.resolved.provenance === this.resolved.provenance
    );
  }

  toDOM(): HTMLElement {
    const markup = calcValueMarkup(this.resolved);
    const root = document.createElement("span");

    root.className = `${markup.rootClassName} vault-cm-calc`;
    root.dataset.calcState = markup.state;
    root.title = markup.title;

    for (const part of markup.parts) {
      const span = document.createElement("span");
      span.className = part.className;
      span.textContent = part.text;

      if (part.decorative) {
        span.setAttribute("aria-hidden", "true");
      }

      root.append(span);
    }

    return root;
  }

  /**
   * Let clicks through to CodeMirror so a click on the value places the cursor
   * inside the source, which is how every other live block reveals itself.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

/** Ranges a `:calc` must not be recognized inside. */
function getExclusions(state: EditorState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];

  syntaxTree(state).iterate({
    enter(node) {
      // `InlineCode` matters as much as the fenced kinds here: `` `:calc[…]` ``
      // is how the docs show the syntax without evaluating it.
      if (
        node.name === "FencedCode" ||
        node.name === "CodeBlock" ||
        node.name === "InlineCode"
      ) {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });

  return ranges;
}

/** True when the selection touches the range, which reveals its source. */
function isActive(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

type LocatedOccurrence = CalcOccurrence & {
  from: number;
  to: number;
  collapsed?: boolean;
};

/**
 * Collects every occurrence in the document, in offset order.
 *
 * Order is the binding contract — `rent` must be defined above the line that
 * reads it — and in the editor the document is one flat text, so offset order
 * *is* document order. Block statements and inline values interleave by
 * position exactly as a reader would meet them.
 */
function locateOccurrences(state: EditorState): LocatedOccurrence[] {
  const text = state.doc.toString();
  const exclusions = getExclusions(state);
  const blocks = scanCalcBlocks(text);

  const inBlock = (offset: number) =>
    blocks.some((block) => offset >= block.from && offset < block.to);

  const found: LocatedOccurrence[] = [];

  for (const block of blocks) {
    const attributes = parseAttributeString(block.attributes);
    const presentation = parseCalcPresentation(attributes);
    const collapsed = Object.hasOwn(attributes, "collapsed");

    block.statements.forEach((statement, index) => {
      found.push({
        key: `b${block.from}:${index}`,
        expression: statement.source,
        presentation,
        context: "block",
        from: block.from,
        to: block.to,
        collapsed,
      });
    });
  }

  for (const match of scanInlineCalc(text, (from, to) =>
    exclusions.some((range) => from < range.to && to > range.from),
  )) {
    // A `:::calc` block's body is already collected line by line; an inline
    // `:calc[…]` written inside one would otherwise be counted twice.
    if (inBlock(match.from)) {
      continue;
    }

    found.push({
      key: `i${match.from}`,
      expression: match.expression,
      presentation: parseCalcPresentation(
        parseAttributeString(match.attributes),
      ),
      context: "inline",
      from: match.from,
      to: match.to,
    });
  }

  return found.sort((a, b) => a.from - b.from);
}

/**
 * Line numbers a `:::calc` block occupies.
 *
 * The editor's markdown live-preview pass consults this so it leaves calc
 * statements alone once a block has revealed its source: `total = rent * 3 +
 * cost * 2` is arithmetic, and letting the markdown parser read those asterisks
 * as emphasis would hide them from the author mid-expression.
 */
export function getCalcBlockLineNumbers(state: EditorState): Set<number> {
  const lineNumbers = new Set<number>();

  for (const block of scanCalcBlocks(state.doc.toString())) {
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      lineNumbers.add(line);
    }
  }

  return lineNumbers;
}

/**
 * Where the cursor belongs after a click on a rendered row: the end of that
 * row's source line, ready to keep typing.
 *
 * Read from live state rather than from anything captured when the widget was
 * built, so an edit elsewhere in the document cannot leave a stale offset
 * behind. Returns null when the press did not resolve to a statement, in which
 * case CodeMirror's own placement stands.
 */
function statementPositionForPressedRow(state: EditorState): number | null {
  if (pressedRowIndex === null) {
    return null;
  }

  const head = state.selection.main.head;
  const block = scanCalcBlocks(state.doc.toString()).find(
    (candidate) => head >= candidate.from && head <= candidate.to,
  );

  return block?.statements[pressedRowIndex]?.to ?? null;
}

function buildCalcDecorations(
  state: EditorState,
  options: CalcLiveOptions,
): DecorationSet {
  const located = locateOccurrences(state);

  if (located.length === 0) {
    return Decoration.none;
  }

  // `calc_currency` is read from the live document, so changing it in the
  // Properties block re-denominates every value as you type. `calc_rate_date`
  // cannot follow suit: it selects which table to fetch, which happened on the
  // server, so a pin edited mid-session takes effect on the next load.
  const { displayCurrency } = parseCalcSettings(state.doc.toString());

  const { results } = resolveCalcOccurrences(located, {
    fxTable: options.fxTable ?? null,
    displayCurrency,
  });

  const ranges: Range<Decoration>[] = [];
  const blocks = new Map<
    string,
    { from: number; to: number; collapsed: boolean; rows: ResolvedCalc[] }
  >();

  for (const occurrence of located) {
    if (occurrence.context === "block") {
      const resolved = results.get(occurrence.key);

      if (!resolved) {
        continue;
      }

      const id = String(occurrence.from);
      const group = blocks.get(id) ?? {
        from: occurrence.from,
        to: occurrence.to,
        collapsed: occurrence.collapsed ?? false,
        rows: [],
      };

      group.rows.push(resolved);
      blocks.set(id, group);
      continue;
    }

    if (isActive(state, occurrence.from, occurrence.to)) {
      continue;
    }

    const resolved = results.get(occurrence.key);

    if (!resolved) {
      continue;
    }

    ranges.push(
      Decoration.replace({ widget: new CalcInlineWidget(resolved) }).range(
        occurrence.from,
        occurrence.to,
      ),
    );
  }

  for (const block of blocks.values()) {
    if (isActive(state, block.from, block.to) || block.rows.length === 0) {
      continue;
    }

    ranges.push(
      Decoration.replace({
        block: true,
        widget: new CalcBlockWidget(block.rows, block.collapsed),
      }).range(block.from, block.to),
    );
  }

  return Decoration.set(ranges, true);
}

/**
 * Live-mode `:calc` decorations. Rebuilt on document *and* selection changes —
 * selection matters because moving the cursor into a value is what reveals its
 * source.
 */
export function createCalcLiveExtension(options: CalcLiveOptions) {
  const decorations = StateField.define<DecorationSet>({
    create(state) {
      return buildCalcDecorations(state, options);
    },
    update(current, transaction) {
      if (!transaction.docChanged && !transaction.selection) {
        return current;
      }

      return buildCalcDecorations(transaction.state, options);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return [
    decorations,
    EditorView.domEventHandlers({
      // A click on a rendered row lands the cursor on that row's source line
      // instead of at the block's edge. Only for a click: a non-empty selection
      // means the press turned into a drag, and that selection is the user's.
      mouseup(_event, view) {
        const position = view.state.selection.main.empty
          ? statementPositionForPressedRow(view.state)
          : null;
        pressedRowIndex = null;

        if (position === null || position === view.state.selection.main.head) {
          return false;
        }

        view.dispatch({
          selection: EditorSelection.cursor(position),
          scrollIntoView: true,
        });
        return false;
      },
    }),
  ];
}
