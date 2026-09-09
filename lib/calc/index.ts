/**
 * Public surface of the `:calc` engine.
 *
 * Everything here is pure, dependency-free, and framework-free by design — the
 * same module evaluates during RSC render, inside the CodeMirror live
 * decoration, and in an agent action, so a figure can never differ between where
 * it is read and where it is edited.
 *
 * Currency is a *unit inside* this calculator, not the point of it: `:calc[3 * 7]`
 * is as valid as `:calc[rent in USD]`.
 */

export {
  DIVISION_SCALE,
  MAX_INTEGER_DIGITS,
  MAX_SCALE,
  ONE,
  ZERO,
  decimalFromString,
  decimalToNumber,
  decimalToString,
  type Decimal,
} from "@/lib/calc/decimal";

export {
  DEFAULT_CALC_LOCALE,
  PLAIN_DISPLAY_SCALE,
  currencyMinorUnits,
  currencyName,
  formatMoney,
  isCurrencyCode,
  listCurrencies,
  listCurrencyCodes,
} from "@/lib/calc/currency";

export {
  MAX_EXPRESSION_LENGTH,
  MAX_TOKENS,
  tokenize,
  type Token,
  type TokenKind,
} from "@/lib/calc/tokenizer";

export {
  MAX_DEPTH,
  parse,
  type BinaryOperator,
  type CalcNode,
  type CalcStatement,
} from "@/lib/calc/parser";

export {
  evaluateDocument,
  evaluateExpression,
  type CalcDocumentResult,
  type CalcEntry,
  type CalcScope,
  type EvaluateOptions,
} from "@/lib/calc/evaluate";

export {
  NO_RATES,
  type CalcError,
  type CalcErrorCode,
  type CalcOutcome,
  type CalcValue,
  type RateResolver,
} from "@/lib/calc/types";
