import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
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
 * ## Why a `:::calc` block is *not* replaced by a block widget
 *
 * It used to be, and that was wrong twice over.
 *
 * A replace widget is opaque to CodeMirror: it has no idea which source
 * character any pixel inside it stands for, so every click in the block landed
 * on `from` or `to`. For a callout or a table that is tolerable, because the
 * rendered form is what you want to look at and the source is markup noise. A
 * declarations block is the opposite case — `rent = 1200 CAD` *is* the content,
 * and the only thing rendering adds is the computed figure beside it. So the
 * statement lines stay real, editable, selectable text and the value is
 * appended as a small inline widget. Clicking, dragging and typing then work
 * because there is nothing there but text.
 *
 * It was also the cause of a document-wide coordinate bug. CodeMirror measures
 * a block widget with `getBoundingClientRect()`, which excludes margins, so the
 * `margin: 1rem 0` on `.vault-calc-block` was invisible to the height map and
 * every line *below* a calc block sat 32px lower than CodeMirror believed —
 * clicks in the rest of the document landed a line or two off. (This is what
 * `applyStableBlockWidgetSpacing` in `live-blocks.ts` exists to prevent; the
 * rule is that a block widget must carry its spacing as padding, never margin.)
 * Decorating lines in place removes the block widget, and with it the hazard.
 *
 * ## Consistency with Read mode
 *
 * Occurrences are located by raw-text scan (`lib/calc/scan.ts`) rather than by
 * parsing with remark, because remark on every keystroke is far too expensive.
 * The two locators are held equivalent by `lib/calc/scan.test.ts`, and both then
 * go through the *same* `resolveCalcOccurrences`, so a figure is identical in
 * the editor and on the page.
 */

export type CalcLiveOptions = {
  fxTable?: FxRateTable | null;
};

/** The `:::calc` opening fence, shown as a label instead of its source. */
class CalcFenceWidget extends WidgetType {
  constructor(private readonly collapsed: boolean) {
    super();
  }

  eq(other: CalcFenceWidget): boolean {
    return other.collapsed === this.collapsed;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "vault-cm-calc-fence";

    const label = document.createElement("span");
    label.className = "vault-cm-calc-fence-label";
    label.textContent = "calc";
    root.append(label);

    if (this.collapsed) {
      const note = document.createElement("span");
      note.className = "vault-cm-calc-fence-note";
      note.textContent = "collapsed for readers";
      root.append(note);
    }

    return root;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * The computed figure for one statement line, appended after its source.
 *
 * A point widget rather than a replacement: the statement stays as text, so the
 * cursor can be put anywhere in it and the value re-computes as it is edited.
 */
class CalcRowValueWidget extends WidgetType {
  constructor(private readonly resolved: ResolvedCalc) {
    super();
  }

  eq(other: CalcRowValueWidget): boolean {
    return (
      other.resolved.value === this.resolved.value &&
      other.resolved.state === this.resolved.state &&
      other.resolved.message === this.resolved.message &&
      other.resolved.provenance === this.resolved.provenance
    );
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "vault-cm-calc-row";

    // The name and the working are already on screen in the source, so the
    // widget shows the result alone — repeating the label would double every
    // line. An error shows its reason instead, for the same reason: echoing
    // back the expression the author is looking at says nothing.
    if (this.resolved.state === "error") {
      root.classList.add("vault-cm-calc-row-error");
      root.title = this.resolved.message ?? "Could not evaluate.";
      root.textContent = this.resolved.message ?? "Could not evaluate.";
      return root;
    }

    const markup = calcValueMarkup({
      ...this.resolved,
      label: null,
      labelKind: null,
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

    root.append(value);
    return root;
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

const calcBlockLine = Decoration.line({ class: "vault-cm-calc-block-line" });
const calcBlockFirstLine = Decoration.line({
  class: "vault-cm-calc-block-line vault-cm-calc-block-line-first",
});
const calcBlockLastLine = Decoration.line({
  class: "vault-cm-calc-block-line vault-cm-calc-block-line-last",
});
/** The closing fence with its `:::` hidden, collapsed to a thin bottom edge. */
const calcBlockClosedLine = Decoration.line({
  class:
    "vault-cm-calc-block-line vault-cm-calc-block-line-last vault-cm-calc-block-line-closed",
});

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
};

type LocatedBlock = {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  closed: boolean;
  collapsed: boolean;
  statements: Array<{ key: string; from: number; to: number }>;
};

/**
 * Collects every occurrence in the document, in offset order.
 *
 * Order is the binding contract — `rent` must be defined above the line that
 * reads it — and in the editor the document is one flat text, so offset order
 * *is* document order. Block statements and inline values interleave by
 * position exactly as a reader would meet them.
 */
function locateOccurrences(state: EditorState): {
  occurrences: LocatedOccurrence[];
  blocks: LocatedBlock[];
} {
  const text = state.doc.toString();
  const exclusions = getExclusions(state);
  const scanned = scanCalcBlocks(text);

  const inBlock = (offset: number) =>
    scanned.some((block) => offset >= block.from && offset < block.to);

  const occurrences: LocatedOccurrence[] = [];
  const blocks: LocatedBlock[] = [];

  for (const block of scanned) {
    const attributes = parseAttributeString(block.attributes);
    const presentation = parseCalcPresentation(attributes);
    const located: LocatedBlock = {
      from: block.from,
      to: block.to,
      startLine: block.startLine,
      endLine: block.endLine,
      closed: block.closed,
      collapsed: Object.hasOwn(attributes, "collapsed"),
      statements: [],
    };

    for (const statement of block.statements) {
      const key = `b${statement.from}`;

      occurrences.push({
        key,
        expression: statement.source,
        presentation,
        context: "block",
        from: statement.from,
        to: statement.to,
      });
      located.statements.push({
        key,
        from: statement.from,
        to: statement.to,
      });
    }

    blocks.push(located);
  }

  for (const match of scanInlineCalc(text, (from, to) =>
    exclusions.some((range) => from < range.to && to > range.from),
  )) {
    // A `:::calc` block's body is already collected line by line; an inline
    // `:calc[…]` written inside one would otherwise be counted twice.
    if (inBlock(match.from)) {
      continue;
    }

    occurrences.push({
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

  occurrences.sort((a, b) => a.from - b.from);

  return { occurrences, blocks };
}

/**
 * Line numbers a `:::calc` block occupies.
 *
 * The editor's markdown live-preview pass consults this so it leaves calc
 * statements alone: `total = rent * 3 + cost * 2` is arithmetic, and letting the
 * markdown parser read the asterisks as emphasis would hide them and silently
 * change the expression the author is looking at.
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

function buildCalcDecorations(
  state: EditorState,
  options: CalcLiveOptions,
): DecorationSet {
  const { occurrences, blocks } = locateOccurrences(state);

  if (occurrences.length === 0 && blocks.length === 0) {
    return Decoration.none;
  }

  // `calc_currency` is read from the live document, so changing it in the
  // Properties block re-denominates every value as you type. `calc_rate_date`
  // cannot follow suit: it selects which table to fetch, which happened on the
  // server, so a pin edited mid-session takes effect on the next load.
  const { displayCurrency } = parseCalcSettings(state.doc.toString());

  const { results } = resolveCalcOccurrences(occurrences, {
    fxTable: options.fxTable ?? null,
    displayCurrency,
  });

  const ranges: Range<Decoration>[] = [];

  for (const occurrence of occurrences) {
    if (occurrence.context === "block" || isActive(state, occurrence.from, occurrence.to)) {
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

  for (const block of blocks) {
    const openLine = state.doc.line(block.startLine);
    const closeLine = block.closed ? state.doc.line(block.endLine) : null;
    const closeHidden =
      closeLine !== null && !isActive(state, closeLine.from, closeLine.to);

    for (let number = block.startLine; number <= block.endLine; number += 1) {
      const decoration =
        number === block.startLine
          ? calcBlockFirstLine
          : closeLine && number === block.endLine
            ? closeHidden
              ? calcBlockClosedLine
              : calcBlockLastLine
            : calcBlockLine;

      ranges.push(decoration.range(state.doc.line(number).from));
    }

    // The fences carry no information once the block is framed, so the opening
    // one becomes a label and the closing one disappears into the bottom edge —
    // but only while the cursor is elsewhere, since an author editing a fence
    // needs to see what they are editing.
    if (!isActive(state, openLine.from, openLine.to)) {
      ranges.push(
        Decoration.replace({
          widget: new CalcFenceWidget(block.collapsed),
        }).range(openLine.from, openLine.to),
      );
    }

    if (closeLine && closeHidden) {
      ranges.push(Decoration.replace({}).range(closeLine.from, closeLine.to));
    }

    for (const statement of block.statements) {
      const resolved = results.get(statement.key);

      if (!resolved) {
        continue;
      }

      ranges.push(
        Decoration.widget({
          widget: new CalcRowValueWidget(resolved),
          side: 1,
        }).range(statement.to),
      );
    }
  }

  return Decoration.set(ranges, true);
}

/**
 * Live-mode `:calc` decorations. Rebuilt on document *and* selection changes —
 * selection matters because moving the cursor into a value is what reveals its
 * source.
 */
export function createCalcLiveExtension(options: CalcLiveOptions) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildCalcDecorations(state, options);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged && !transaction.selection) {
        return decorations;
      }

      return buildCalcDecorations(transaction.state, options);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}
