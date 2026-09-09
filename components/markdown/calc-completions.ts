import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { type EditorState } from "@codemirror/state";

import { formatMoney, listCurrencies } from "@/lib/calc/currency";
import { evaluateDocument } from "@/lib/calc/evaluate";
import { createRateResolver, type FxRateTable } from "@/lib/calc/fx";
import { findCalcBlockBody } from "@/lib/calc/scan";

import { isInsideCode } from "./completion-context";
import { locateCalcOccurrences } from "./live-calc";

/**
 * Operand completion inside `:calc` expressions — the names this document binds
 * and the currency codes it can use.
 *
 * Registered in the same `autocompletion({ override })` list as the wiki-link,
 * asset, and slash sources, so it inherits the one tooltip: same keyboard
 * navigation, same filtering, same styling. Nothing bespoke is drawn here.
 *
 * ## What may be completed is decided by where the cursor is
 *
 * A naive menu would offer all 160-odd ISO codes alongside every bound name at
 * every position, which is noise at best and misleading at worst — most of those
 * options would not parse where they were offered. The calc grammar is small
 * enough to do better, and its own disambiguation rule does most of the work:
 *
 *   > Codes must be written uppercase. That is the whole disambiguation rule
 *   > between a unit and an identifier: `CAD` is money, `cad` is a variable.
 *   > (`lib/calc/currency.ts`)
 *
 * So the menu reads the text to the left of the token being typed:
 *
 * | Left of the cursor | Offered |
 * |---|---|
 * | `… in` / `… to` | currencies only — the parser *requires* a code here |
 * | a bare number, e.g. `1200 ` | currencies only — an identifier cannot follow |
 * | anything else | names and functions; currencies once the token is uppercase |
 *
 * That last row is why `re` offers `rent` and never `Real`, while `CA` offers
 * `CAD`. It is the language's rule, not a heuristic layered on top of it.
 *
 * ## Scope is positional, like the evaluator's
 *
 * Names bind top to bottom (`lib/calc/evaluate.ts`), so the menu offers only
 * names bound *above* the statement being edited — the same names the evaluator
 * would have in hand at that point. Offering a name defined further down would
 * suggest an expression that renders as `unknown-name` the moment it is typed.
 */

export type CalcCompletionOptions = {
  fxTable?: FxRateTable | null;
};

/** The parser demands a currency code after these; nothing else is valid. */
const AFTER_CONVERSION_KEYWORD = /\b(?:in|to)\s*$/;

/**
 * A bare number immediately before the token, i.e. an amount awaiting its unit.
 * The leading boundary keeps `rent2 ` from reading as a number — only a literal
 * that is not part of a longer identifier counts.
 */
const AFTER_NUMBER = /(?:^|[^\w.])\d[\d_,]*(?:\.\d+)?\s*$/;

/** Identifier being typed at the cursor, if any. */
const TRAILING_IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*$/;

/** Built-in functions, with the shape that reads best as a one-line hint. */
const CALC_FUNCTIONS: Array<{ name: string; signature: string }> = [
  { name: "sum", signature: "sum(a, b, …)" },
  { name: "avg", signature: "avg(a, b, …)" },
  { name: "min", signature: "min(a, b, …)" },
  { name: "max", signature: "max(a, b, …)" },
  { name: "abs", signature: "abs(x)" },
  { name: "round", signature: "round(x, places?)" },
];

type CalcCursorContext = {
  /** Start of the token being completed. */
  from: number;
  /** The partial identifier typed so far; empty at an operand boundary. */
  token: string;
  /** Expression text to the left of the token, on this statement. */
  before: string;
  /** Offset where this statement's own source begins. */
  statementFrom: number;
};

/**
 * Locates the cursor inside a calc expression, or returns null so the tooltip
 * never opens. Two shapes carry expressions, and both are raw text at the moment
 * the cursor is in them — an inline value reveals its source when touched.
 */
function findCalcCursorContext(
  state: EditorState,
  pos: number,
): CalcCursorContext | null {
  const line = state.doc.lineAt(pos);
  const beforeCursor = state.sliceDoc(line.from, pos);

  // Inline: the nearest `:calc[` on this line that the cursor has not yet
  // passed the `]` of. Expressions cannot span lines, so the line is the whole
  // search space.
  const inline = /:calc\[([^\]\n]*)$/.exec(beforeCursor);

  if (inline) {
    const expression = inline[1] ?? "";
    return isInsideCode(state, pos)
      ? null
      : describeCursor(pos - expression.length, expression);
  }

  // Block: a body line of a `:::calc` block. `findCalcBlockBody` already skips
  // fenced code and excludes the fence lines themselves.
  const block = findCalcBlockBody(state.doc.toString(), line.number);

  return block ? describeCursor(line.from, beforeCursor) : null;
}

function describeCursor(
  statementFrom: number,
  expression: string,
): CalcCursorContext {
  const token = TRAILING_IDENTIFIER.exec(expression)?.[0] ?? "";

  return {
    from: statementFrom + expression.length - token.length,
    token,
    before: expression.slice(0, expression.length - token.length),
    statementFrom,
  };
}

/**
 * Names bound above `statementFrom`, with the value each carries there.
 *
 * Runs the real evaluator over the real occurrences rather than pattern-matching
 * for `name =`: a binding whose expression fails does not bind, and the menu
 * must not offer a name that would resolve to `unknown-name`.
 */
function bindingsInScope(
  state: EditorState,
  statementFrom: number,
  fxTable: FxRateTable | null,
) {
  const above = locateCalcOccurrences(state).filter(
    (occurrence) => occurrence.sourceFrom < statementFrom,
  );

  return evaluateDocument(
    above.map((occurrence) => ({
      id: occurrence.key,
      source: occurrence.expression,
    })),
    { rates: createRateResolver(fxTable) },
  ).bindings;
}

const startsUppercase = (text: string) => /^[A-Z]/.test(text);

export function createCalcCompletionSource(
  options: CalcCompletionOptions = {},
): CompletionSource {
  const fxTable = options.fxTable ?? null;

  return (context: CompletionContext): CompletionResult | null => {
    const cursor = findCalcCursorContext(context.state, context.pos);

    if (!cursor) {
      return null;
    }

    const currencyOnly =
      AFTER_CONVERSION_KEYWORD.test(cursor.before) ||
      AFTER_NUMBER.test(cursor.before);
    const completions: Completion[] = [];

    if (!currencyOnly) {
      for (const [name, value] of bindingsInScope(
        context.state,
        cursor.statementFrom,
        fxTable,
      )) {
        completions.push({
          label: name,
          // What the name is worth here, in the currency it was bound in. A
          // document-wide `calc_currency` may re-denominate it on the page; this
          // hint answers "what did I call 1200 CAD?", which is the question a
          // half-typed name is asking.
          detail: formatMoney(value.amount, value.currency),
          type: "vault-calc-name",
          // Ahead of currencies and functions: a document's own names are what
          // an author reaches for, and they are the only options that cannot be
          // recalled from memory.
          boost: 1,
        });
      }

      for (const fn of CALC_FUNCTIONS) {
        completions.push({
          label: fn.name,
          detail: fn.signature,
          type: "vault-calc-function",
          apply: `${fn.name}(`,
          boost: -1,
        });
      }
    }

    if (currencyOnly || startsUppercase(cursor.token)) {
      for (const currency of listCurrencies()) {
        completions.push({
          label: currency.code,
          detail: currency.name,
          type: "vault-calc-currency",
        });
      }
    }

    if (completions.length === 0) {
      return null;
    }

    return {
      from: cursor.from,
      to: context.pos,
      options: completions,
      // Re-filters as the token grows, but only while it stays the same *kind*
      // of token. Crossing the case boundary changes which options exist at all
      // — an empty token offers no currencies, and `C` must offer them — so that
      // transition has to re-query rather than filter a stale list.
      validFor: (text: string) =>
        /^[A-Za-z0-9_]*$/.test(text) &&
        (currencyOnly || startsUppercase(text) === startsUppercase(cursor.token)),
    };
  };
}
