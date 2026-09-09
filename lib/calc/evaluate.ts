/**
 * Evaluation and the unit algebra for `:calc`.
 *
 * Exactly one dimension exists in this version: currency. A value is either
 * money (`currency: "CAD"`) or dimensionless (`currency: null`), and the rules
 * below are the complete algebra:
 *
 *   CAD + CAD -> CAD          CAD + USD -> converts, or `missing-rate`
 *   CAD + 3   -> error        CAD * 3   -> CAD
 *   CAD * CAD -> error        CAD / CAD -> dimensionless
 *   CAD / 3   -> CAD          3 / CAD   -> error
 *
 * Small, closed, and statically checkable. General dimensional analysis
 * (`1200 CAD/mo * 3 mo`) is a much larger system and is deliberately out of
 * scope; nothing here forecloses adding it later.
 */

import {
  ZERO,
  absolute,
  add,
  compare,
  divide,
  isInteger,
  decimalToNumber,
  exceedsMagnitudeLimit,
  multiply,
  negate,
  percent,
  power,
  roundTo,
  subtract,
  type Decimal,
} from "@/lib/calc/decimal";
import { currencyMinorUnits } from "@/lib/calc/currency";
import type { FxConversion } from "@/lib/calc/fx";
import { parse, type CalcNode } from "@/lib/calc/parser";
import {
  NO_RATES,
  fail,
  ok,
  type CalcOutcome,
  type CalcValue,
  type RateResolver,
} from "@/lib/calc/types";

/** Names bound earlier in the document, in source order. */
export type CalcScope = ReadonlyMap<string, CalcValue>;

export type EvaluateOptions = {
  rates?: RateResolver;
};

/** Total node visits allowed per expression. Backstop on the parser's caps. */
const MAX_EVAL_STEPS = 2000;

const FUNCTION_ARITY: Record<string, { min: number; max: number }> = {
  sum: { min: 0, max: Infinity },
  avg: { min: 1, max: Infinity },
  min: { min: 1, max: Infinity },
  max: { min: 1, max: Infinity },
  round: { min: 1, max: 2 },
  abs: { min: 1, max: 1 },
};

function money(amount: Decimal, currency: string | null): CalcValue {
  return { amount, currency };
}

/**
 * Brings `value` into `target`, or reports why it cannot. Converting *to* a
 * currency from a dimensionless number is an error rather than an implicit
 * "assume it was already dollars" — silently unit-ing a bare number is how a
 * report ends up off by a factor nobody can trace.
 */
function convert(
  value: CalcValue,
  target: string,
  rates: RateResolver,
  position: number,
  budget?: EvalBudget,
): CalcOutcome<CalcValue> {
  if (value.currency === null) {
    return fail(
      "unit-mismatch",
      `Cannot convert a plain number to ${target}; it has no currency.`,
      position,
    );
  }

  if (value.currency === target) {
    return ok(value);
  }

  const rate = rates.rate(value.currency, target);

  if (!rate) {
    return fail(
      "missing-rate",
      `No exchange rate available for ${value.currency} to ${target}.`,
      position,
    );
  }

  // Recorded so the renderer can show which rate produced the figure. A
  // converted number without visible provenance is unfalsifiable.
  budget?.conversions.push({ from: value.currency, to: target });

  return ok(money(multiply(value.amount, rate), target));
}

/**
 * Puts two operands on a common currency for `+`, `-`, and comparison. The left
 * operand wins, so `rent + fee` reports in whatever `rent` is denominated in —
 * reading order decides, which is predictable without knowing the rate table.
 */
function unify(
  left: CalcValue,
  right: CalcValue,
  rates: RateResolver,
  position: number,
  operation: string,
  budget?: EvalBudget,
): CalcOutcome<{ left: CalcValue; right: CalcValue; currency: string | null }> {
  if (left.currency === right.currency) {
    return ok({ left, right, currency: left.currency });
  }

  if (left.currency === null || right.currency === null) {
    const monetary = left.currency ?? right.currency;

    return fail(
      "unit-mismatch",
      `Cannot ${operation} a plain number and ${monetary}. Give both a currency, or neither.`,
      position,
    );
  }

  const converted = convert(right, left.currency, rates, position, budget);

  if (!converted.ok) {
    return converted;
  }

  return ok({ left, right: converted.value, currency: left.currency });
}

export function evaluateExpression(
  source: string,
  scope: CalcScope,
  options: EvaluateOptions = {},
): CalcOutcome<CalcValue> {
  const parsed = parse(source);

  if (!parsed.ok) {
    return parsed;
  }

  return evaluateNode(parsed.value.expression, scope, options.rates ?? NO_RATES, newBudget());
}

type EvalBudget = { steps: number; conversions: FxConversion[] };

function newBudget(): EvalBudget {
  return { steps: 0, conversions: [] };
}

function evaluateNode(
  node: CalcNode,
  scope: CalcScope,
  rates: RateResolver,
  budget: EvalBudget,
): CalcOutcome<CalcValue> {
  budget.steps += 1;

  if (budget.steps > MAX_EVAL_STEPS) {
    return fail("limit-exceeded", "Expression is too complex to evaluate.");
  }

  switch (node.kind) {
    case "literal":
      return ok(money(node.value, node.currency));

    case "reference": {
      const bound = scope.get(node.name);

      if (!bound) {
        return fail(
          "unknown-name",
          `"${node.name}" is not defined above this point.`,
          node.position,
        );
      }

      return ok(bound);
    }

    case "negate": {
      const operand = evaluateNode(node.operand, scope, rates, budget);

      if (!operand.ok) {
        return operand;
      }

      return ok(money(negate(operand.value.amount), operand.value.currency));
    }

    case "percent": {
      const operand = evaluateNode(node.operand, scope, rates, budget);

      if (!operand.ok) {
        return operand;
      }

      if (operand.value.currency !== null) {
        return fail(
          "unit-mismatch",
          `"%" applies to a plain number, not to ${operand.value.currency}.`,
          node.position,
        );
      }

      return ok(money(percent(operand.value.amount), null));
    }

    case "convert": {
      const operand = evaluateNode(node.operand, scope, rates, budget);

      if (!operand.ok) {
        return operand;
      }

      return convert(operand.value, node.currency, rates, node.position, budget);
    }

    case "binary":
      return evaluateBinary(node, scope, rates, budget);

    case "call":
      return evaluateCall(node, scope, rates, budget);
  }
}

function evaluateBinary(
  node: Extract<CalcNode, { kind: "binary" }>,
  scope: CalcScope,
  rates: RateResolver,
  budget: EvalBudget,
): CalcOutcome<CalcValue> {
  const left = evaluateNode(node.left, scope, rates, budget);

  if (!left.ok) {
    return left;
  }

  const right = evaluateNode(node.right, scope, rates, budget);

  if (!right.ok) {
    return right;
  }

  const a = left.value;
  const b = right.value;

  switch (node.operator) {
    case "+":
    case "-": {
      const unified = unify(
        a,
        b,
        rates,
        node.position,
        node.operator === "+" ? "add" : "subtract",
        budget,
      );

      if (!unified.ok) {
        return unified;
      }

      const amount =
        node.operator === "+"
          ? add(unified.value.left.amount, unified.value.right.amount)
          : subtract(unified.value.left.amount, unified.value.right.amount);

      return ok(money(amount, unified.value.currency));
    }

    case "*": {
      if (a.currency !== null && b.currency !== null) {
        return fail(
          "unit-mismatch",
          `Cannot multiply ${a.currency} by ${b.currency}; the result would be a squared currency.`,
          node.position,
        );
      }

      const result = multiply(a.amount, b.amount);

      if (exceedsMagnitudeLimit(result)) {
        return fail("limit-exceeded", "Result is too large.", node.position);
      }

      return ok(money(result, a.currency ?? b.currency));
    }

    case "/": {
      if (a.currency === null && b.currency !== null) {
        return fail(
          "unit-mismatch",
          `Cannot divide a plain number by ${b.currency}.`,
          node.position,
        );
      }

      // Money over money is a ratio: unify first so `100 CAD / 50 USD` converts
      // rather than silently comparing unlike units.
      let numerator = a;
      let denominator = b;
      let resultCurrency: string | null = a.currency;

      if (a.currency !== null && b.currency !== null) {
        const unified = unify(a, b, rates, node.position, "divide", budget);

        if (!unified.ok) {
          return unified;
        }

        numerator = unified.value.left;
        denominator = unified.value.right;
        resultCurrency = null;
      }

      const result = divide(numerator.amount, denominator.amount);

      if (!result) {
        return fail("divide-by-zero", "Division by zero.", node.position);
      }

      return ok(money(result, resultCurrency));
    }

    case "^": {
      if (a.currency !== null || b.currency !== null) {
        return fail(
          "unit-mismatch",
          "Exponentiation needs plain numbers on both sides.",
          node.position,
        );
      }

      if (!isInteger(b.amount)) {
        return fail(
          "bad-call",
          "Exponent must be a whole number.",
          node.position,
        );
      }

      const exponent = decimalToNumber(b.amount);
      const magnitude = power(a.amount, Math.abs(exponent));

      if (!magnitude) {
        return fail("limit-exceeded", "Result is too large.", node.position);
      }

      if (exponent >= 0) {
        return ok(money(magnitude, null));
      }

      const reciprocal = divide({ mantissa: 1n, scale: 0 }, magnitude);

      if (!reciprocal) {
        return fail("divide-by-zero", "Division by zero.", node.position);
      }

      return ok(money(reciprocal, null));
    }
  }
}

function evaluateCall(
  node: Extract<CalcNode, { kind: "call" }>,
  scope: CalcScope,
  rates: RateResolver,
  budget: EvalBudget,
): CalcOutcome<CalcValue> {
  const arity = FUNCTION_ARITY[node.name];

  if (!arity) {
    return fail(
      "bad-call",
      `Unknown function "${node.name}". Available: ${Object.keys(FUNCTION_ARITY).join(", ")}.`,
      node.position,
    );
  }

  if (node.args.length < arity.min || node.args.length > arity.max) {
    return fail(
      "bad-call",
      `"${node.name}" takes ${arity.min === arity.max ? arity.min : `${arity.min}-${arity.max === Infinity ? "any" : arity.max}`} argument(s), got ${node.args.length}.`,
      node.position,
    );
  }

  const values: CalcValue[] = [];

  for (const argument of node.args) {
    const evaluated = evaluateNode(argument, scope, rates, budget);

    if (!evaluated.ok) {
      return evaluated;
    }

    values.push(evaluated.value);
  }

  switch (node.name) {
    case "sum":
      return reduceToTotal(values, rates, node.position, budget);

    case "avg": {
      const total = reduceToTotal(values, rates, node.position, budget);

      if (!total.ok) {
        return total;
      }

      const mean = divide(total.value.amount, {
        mantissa: BigInt(values.length),
        scale: 0,
      });

      if (!mean) {
        return fail("divide-by-zero", "Division by zero.", node.position);
      }

      return ok(money(mean, total.value.currency));
    }

    case "min":
    case "max":
      return selectExtreme(values, node.name, rates, node.position, budget);

    case "abs":
      return ok(money(absolute(values[0].amount), values[0].currency));

    case "round": {
      const target = values[0];
      let places: number;

      if (values.length === 2) {
        const argument = values[1];

        if (argument.currency !== null || !isInteger(argument.amount)) {
          return fail(
            "bad-call",
            "round's second argument must be a whole number of decimal places.",
            node.position,
          );
        }

        places = decimalToNumber(argument.amount);
      } else {
        // Default to the currency's own precision, so `round(total)` on a JPY
        // amount lands on whole yen rather than an invented two decimals.
        places =
          target.currency === null ? 0 : currencyMinorUnits(target.currency);
      }

      if (places < 0 || places > 20) {
        return fail(
          "bad-call",
          "round's decimal places must be between 0 and 20.",
          node.position,
        );
      }

      return ok(money(roundTo(target.amount, places), target.currency));
    }
  }

  return fail("bad-call", `Unknown function "${node.name}".`, node.position);
}

function reduceToTotal(
  values: CalcValue[],
  rates: RateResolver,
  position: number,
  budget: EvalBudget,
): CalcOutcome<CalcValue> {
  if (values.length === 0) {
    return ok(money(ZERO, null));
  }

  let total = values[0];

  for (let index = 1; index < values.length; index += 1) {
    const unified = unify(total, values[index], rates, position, "add", budget);

    if (!unified.ok) {
      return unified;
    }

    total = money(
      add(unified.value.left.amount, unified.value.right.amount),
      unified.value.currency,
    );
  }

  return ok(total);
}

function selectExtreme(
  values: CalcValue[],
  mode: "min" | "max",
  rates: RateResolver,
  position: number,
  budget: EvalBudget,
): CalcOutcome<CalcValue> {
  let best = values[0];

  for (let index = 1; index < values.length; index += 1) {
    const unified = unify(best, values[index], rates, position, "compare", budget);

    if (!unified.ok) {
      return unified;
    }

    const ordering = compare(
      unified.value.right.amount,
      unified.value.left.amount,
    );

    if (mode === "min" ? ordering < 0 : ordering > 0) {
      best = unified.value.right;
    }
  }

  return ok(best);
}

/** One `:calc[…]` occurrence in a document, in source order. */
export type CalcEntry = {
  /** Stable id for the occurrence (its position key in the rendered document). */
  id: string;
  /** Raw expression source, sliced from the markdown — never from parsed children. */
  source: string;
};

export type CalcDocumentResult = {
  /** Outcome per entry id, in the order supplied. */
  results: Map<string, CalcOutcome<CalcValue>>;
  /**
   * The name each entry binds, or null for a bare expression. Surfaced because
   * the renderer shows `rent = CA$1,200.00` in block context and would otherwise
   * have to re-parse every expression purely to recover its name.
   */
  names: Map<string, string | null>;
  /**
   * Currency conversions each entry performed, in order. Drives the value's
   * `converted` state and its provenance tooltip.
   */
  conversions: Map<string, FxConversion[]>;
  /** Names successfully bound, for autocomplete and agent readback. */
  bindings: Map<string, CalcValue>;
};

/**
 * Evaluates a document's `:calc` occurrences top to bottom.
 *
 * Names must be defined before use. That single rule makes evaluation a linear
 * fold, makes reference cycles impossible by construction rather than by cycle
 * detection, and matches how a reader scans the page — a total near the bottom
 * can only depend on figures already read.
 */
export function evaluateDocument(
  entries: readonly CalcEntry[],
  options: EvaluateOptions = {},
): CalcDocumentResult {
  const rates = options.rates ?? NO_RATES;
  const bindings = new Map<string, CalcValue>();
  const results = new Map<string, CalcOutcome<CalcValue>>();
  const names = new Map<string, string | null>();
  const conversions = new Map<string, FxConversion[]>();

  for (const entry of entries) {
    const parsed = parse(entry.source);

    if (!parsed.ok) {
      results.set(entry.id, parsed);
      names.set(entry.id, null);
      continue;
    }

    const { name, expression } = parsed.value;

    names.set(entry.id, name);

    if (name !== null && bindings.has(name)) {
      results.set(
        entry.id,
        fail("duplicate-name", `"${name}" is already defined in this document.`),
      );
      continue;
    }

    // A budget per entry, so each value reports only the conversions its own
    // expression performed.
    const budget = newBudget();
    const evaluated = evaluateNode(expression, bindings, rates, budget);

    results.set(entry.id, evaluated);
    conversions.set(entry.id, budget.conversions);

    if (evaluated.ok && name !== null) {
      bindings.set(name, evaluated.value);
    }
  }

  return { results, names, conversions, bindings };
}
