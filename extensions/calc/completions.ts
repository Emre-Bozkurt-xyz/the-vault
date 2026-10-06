import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { type EditorState } from "@codemirror/state";

import { isInsideCode } from "@/lib/extension-api/codemirror";
import { listCurrencies, type FxRateTable } from "@/lib/extension-api/fx";

import { formatMoney } from "./lib/currency";
import { evaluateDocument } from "./lib/evaluate";
import { createRateResolver } from "./lib/fx";
import { findCalcBlockBody } from "./lib/scan";
import { tokenize, type Token } from "./lib/tokenizer";
import { locateCalcOccurrences } from "./live";

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
 * The menu offers only what the parser would accept at the cursor. It runs the
 * calc tokenizer over the statement to the left of the word being typed and
 * reads the grammar's expectation off the last complete token:
 *
 * | Last token | Expects | Offered |
 * |---|---|---|
 * | none, `=`, an operator, `(`, `,` | an operand | names and functions |
 * | a bare number, e.g. `1200 ` | its unit | currencies |
 * | `in` / `to` | a conversion target | currencies |
 * | a name, a unit, `)`, `%` | an operator | `in` / `to` |
 *
 * So a currency is never offered where it would be read as a stray code
 * (`5 * CAD` does not parse — a code needs an amount), and nothing that starts
 * a new operand is offered after a finished one (`rent CAD`, `1200 CAD rent`).
 * Operators themselves are single characters with nothing to complete.
 *
 * After a finished operand with no word started, the menu stays shut unless
 * asked for (Ctrl+Space): typing a space after `rent` is how every `rent + …`
 * begins, and popping `in`/`to` open there would be noise.
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

/** What the grammar accepts next, judged from the text left of the cursor. */
type Expectation = "operand" | "currency" | "operator";

/** The conversion keywords, offered where an operator could go. */
const CONVERSION_KEYWORDS: Array<{ label: string; detail: string }> = [
  { label: "in", detail: "convert to a currency" },
  { label: "to", detail: "convert to a currency" },
];

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

/**
 * Reads the grammar's expectation off the last complete token of `before`.
 * Returns null when the text does not tokenize (a stray character): the
 * statement is already broken there, and no option would make it parse.
 */
function expectationAfter(before: string): Expectation | null {
  const tokens = tokenize(before);

  if (!tokens.ok) {
    return null;
  }

  // The tokenizer always closes with an `end` token; the one before it is the
  // last thing the author finished writing.
  const last: Token | undefined = tokens.value[tokens.value.length - 2];

  switch (last?.kind) {
    case undefined:
    case "assign":
    case "operator":
    case "lparen":
    case "comma":
      return "operand";
    case "number":
      // `1200 ` still takes a unit. An operator is equally valid, but it is a
      // single character with nothing to complete.
      return "currency";
    case "keyword":
      return "currency";
    case "identifier":
    case "currency":
    case "rparen":
    case "percent":
      return "operator";
    default:
      return null;
  }
}

export function createCalcCompletionSource(
  options: CalcCompletionOptions = {},
): CompletionSource {
  const fxTable = options.fxTable ?? null;

  return (context: CompletionContext): CompletionResult | null => {
    const cursor = findCalcCursorContext(context.state, context.pos);

    if (!cursor) {
      return null;
    }

    const expected = expectationAfter(cursor.before);

    if (
      expected === null ||
      (expected === "operator" && cursor.token === "" && !context.explicit)
    ) {
      return null;
    }

    const completions: Completion[] = [];

    if (expected === "operand") {
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
          // Ahead of functions: a document's own names are what an author
          // reaches for, and they are the only options that cannot be recalled
          // from memory.
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

    if (expected === "currency") {
      for (const currency of listCurrencies()) {
        completions.push({
          label: currency.code,
          detail: currency.name,
          type: "vault-calc-currency",
        });
      }
    }

    if (expected === "operator") {
      for (const keyword of CONVERSION_KEYWORDS) {
        completions.push({
          label: keyword.label,
          detail: keyword.detail,
          type: "vault-calc-keyword",
          // The space is part of the keyword: a target always follows.
          apply: `${keyword.label} `,
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
      // Which options exist depends only on the tokens left of the word, so
      // the list stays valid for as long as the same word keeps growing.
      validFor: /^[A-Za-z0-9_]*$/,
    };
  };
}
