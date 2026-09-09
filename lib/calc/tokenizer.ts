/**
 * Lexer for `:calc[…]` expressions.
 *
 * The one rule that keeps units and variables apart: **a bare uppercase ISO 4217
 * code is a currency, anything else is an identifier.** So `100 CAD` is money,
 * `cad * 2` is a variable, and `rent * VAT` is unambiguous because `VAT` is not
 * an ISO code. The cost is that the ~180 real codes cannot be used as variable
 * names, which the parser reports as `reserved-name` rather than silently
 * shadowing.
 */

import { decimalFromString, type Decimal } from "@/lib/calc/decimal";
import { isCurrencyCode } from "@/lib/calc/currency";
import { fail, ok, type CalcOutcome } from "@/lib/calc/types";

export type TokenKind =
  | "number"
  | "currency"
  | "identifier"
  | "keyword"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "assign"
  | "percent"
  | "end";

export type Token = {
  kind: TokenKind;
  /** Raw source text, or the normalized operator/keyword. */
  text: string;
  /** Present on `number` tokens. */
  value?: Decimal;
  position: number;
};

/**
 * Conversion keywords. Reserved unconditionally rather than contextually: `to`
 * is a plausible variable name, but making its meaning depend on position is the
 * kind of ambiguity that produces expressions nobody can read back.
 */
const KEYWORDS = new Set(["in", "to"]);

const OPERATORS = new Set(["+", "-", "*", "/", "^"]);

/** Guards against a pathological expression pasted into a document. */
export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_TOKENS = 200;

export function tokenize(source: string): CalcOutcome<Token[]> {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    return fail(
      "limit-exceeded",
      `Expression is longer than ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (tokens.length >= MAX_TOKENS) {
      return fail(
        "limit-exceeded",
        `Expression has more than ${MAX_TOKENS} tokens.`,
        index,
      );
    }

    const start = index;

    if (/[0-9]/.test(char)) {
      let raw = "";

      while (index < source.length && /[0-9_]/.test(source[index])) {
        raw += source[index];
        index += 1;
      }

      // A `.` only continues the number when a digit follows, so `sum(a).x`
      // style trailing dots fall through to the stray-character error.
      if (source[index] === "." && /[0-9]/.test(source[index + 1] ?? "")) {
        raw += source[index];
        index += 1;

        while (index < source.length && /[0-9_]/.test(source[index])) {
          raw += source[index];
          index += 1;
        }
      }

      const value = decimalFromString(raw);

      if (!value) {
        return fail("syntax", `"${raw}" is not a valid number.`, start);
      }

      tokens.push({ kind: "number", text: raw, value, position: start });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let word = "";

      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        word += source[index];
        index += 1;
      }

      const kind: TokenKind = KEYWORDS.has(word.toLowerCase())
        ? "keyword"
        : /^[A-Z]{3}$/.test(word) && isCurrencyCode(word)
          ? "currency"
          : "identifier";

      tokens.push({
        kind,
        text: kind === "keyword" ? word.toLowerCase() : word,
        position: start,
      });
      continue;
    }

    index += 1;

    if (OPERATORS.has(char)) {
      tokens.push({ kind: "operator", text: char, position: start });
      continue;
    }

    switch (char) {
      case "(":
        tokens.push({ kind: "lparen", text: char, position: start });
        continue;
      case ")":
        tokens.push({ kind: "rparen", text: char, position: start });
        continue;
      case ",":
        tokens.push({ kind: "comma", text: char, position: start });
        continue;
      case "%":
        tokens.push({ kind: "percent", text: char, position: start });
        continue;
      case "=":
        tokens.push({ kind: "assign", text: char, position: start });
        continue;
      default:
        return fail("syntax", `Unexpected character "${char}".`, start);
    }
  }

  tokens.push({ kind: "end", text: "", position: source.length });

  return ok(tokens);
}
