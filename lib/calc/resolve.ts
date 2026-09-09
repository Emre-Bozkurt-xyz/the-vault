/**
 * Evaluating and resolving `:calc` occurrences to their rendered shape.
 *
 * Deliberately markdown-free so both surfaces share one implementation: Read
 * mode locates occurrences by parsing with remark, Live mode by scanning raw
 * text, and both hand the result to `resolveCalcOccurrences`. If they resolved
 * separately a value could format, label, or state differently in the editor
 * than on the published page.
 */

import { formatMoney } from "@/lib/calc/currency";
import { multiply } from "@/lib/calc/decimal";
import { evaluateDocument, type CalcEntry } from "@/lib/calc/evaluate";
import {
  createRateResolver,
  describeConversion,
  type FxRateTable,
} from "@/lib/calc/fx";
import type { RateResolver } from "@/lib/calc/types";
import type {
  CalcPresentation,
  CalcShowMode,
} from "@/lib/markdown/calc-directive";

/**
 * Rendered state, surfaced as `[data-calc-state]`.
 *
 * `stale` implies `converted` — it is a conversion priced from a table the
 * provider could not confirm, which a reader deserves to be able to tell apart
 * from a current one.
 */
export type CalcRenderState = "ok" | "converted" | "stale" | "error";

export type ResolvedCalc = {
  key: string;
  /** Shown before the `=`; null renders the value alone. */
  label: string | null;
  /** Which contract class the label takes; null when there is no label. */
  labelKind: "name" | "expr" | null;
  /** Formatted result. Empty string when `state` is `error`. */
  value: string;
  /** Raw expression source — the body of an error chip, and the `expr` label. */
  expression: string;
  state: CalcRenderState;
  /** Human-readable failure reason, for the error chip's tooltip. */
  message: string | null;
  /**
   * Rate provenance for a converted value, e.g.
   * `1 CAD = 0.7245 USD · ECB · 2026-09-08`. Null when nothing converted.
   */
  provenance: string | null;
};

export type CalcDocument = {
  results: Map<string, ResolvedCalc>;
  /** Names bound in this document, in source order. */
  bindings: string[];
};

export const EMPTY_CALC_DOCUMENT: CalcDocument = {
  results: new Map(),
  bindings: [],
};

/**
 * One `:calc` occurrence to resolve. Public because Live mode builds these from
 * a raw-text scan (`lib/calc/scan.ts`) rather than from parsed pieces, and must
 * go through the *same* resolver — otherwise a value could format, label, or
 * state differently in the editor than on the page.
 */
export type CalcOccurrence = {
  key: string;
  expression: string;
  presentation: CalcPresentation;
  context: "inline" | "block";
};

/**
 * Chooses what appears beside the value when the author gave no `show=`.
 *
 * The two contexts want opposite defaults and both are unambiguous in place: a
 * declarations block full of bare numbers is unreadable, and nobody writes
 * "Hosting is rent = CA$1,200.00 per month." So a block names its bindings and
 * shows the working for bare expressions, while inline prose shows the value
 * alone — and binding inline still binds, it just reads as the number it is.
 */
function defaultShowMode(
  context: "inline" | "block",
  isBinding: boolean,
): CalcShowMode {
  if (context === "inline") {
    return "value";
  }

  return isBinding ? "name" : "expr";
}

/**
 * Evaluates occurrences in the order given and resolves each to its rendered
 * shape. Order is the contract: names bind top to bottom, so the caller is
 * responsible for supplying document order.
 */
export function resolveCalcOccurrences(
  occurrences: readonly CalcOccurrence[],
  options: {
    rates?: RateResolver;
    locale?: string;
    fxTable?: FxRateTable | null;
    /**
     * Document-level reporting currency (frontmatter `calc_currency`). Acts as
     * the default `{as=…}`; a value carrying its own always wins, so one
     * stubborn figure can stay in its native currency.
     */
    displayCurrency?: string | null;
  } = {},
): CalcDocument {
  const rates =
    options.rates ??
    (options.fxTable ? createRateResolver(options.fxTable) : undefined);
  const fxTable = options.fxTable ?? null;

  const entries: CalcEntry[] = occurrences.map((occurrence) => ({
    id: occurrence.key,
    source: occurrence.expression,
  }));

  const evaluated = evaluateDocument(entries, { rates });
  const results = new Map<string, ResolvedCalc>();

  for (const occurrence of occurrences) {
    const outcome = evaluated.results.get(occurrence.key);
    const name = evaluated.names.get(occurrence.key) ?? null;

    if (!outcome || !outcome.ok) {
      results.set(occurrence.key, {
        key: occurrence.key,
        label: null,
        labelKind: null,
        value: "",
        expression: occurrence.expression,
        state: "error",
        message: outcome?.error.message ?? "Could not evaluate.",
        provenance: null,
      });

      continue;
    }

    const { presentation } = occurrence;

    // `{as=XXX}` re-denominates the *display* only, so it appends to the
    // conversion trail like an in-expression `in XXX` would. When no rate is
    // available the value is shown in its own currency rather than turned into
    // an error: the figure is still correct, just not re-denominated, and a
    // display hint must never invalidate a sound number.
    let displayed = outcome.value;
    const conversions = [...(evaluated.conversions.get(occurrence.key) ?? [])];

    // Precedence: an explicit `{as=…}`, then an explicit `in XXX` inside the
    // expression (which shows up as a conversion the evaluator already
    // performed), then the document default. Anything the author spelled out
    // beats a document-wide preference — otherwise `:calc[rent in EUR]` in a
    // `calc_currency: CAD` document would silently come back as CAD.
    const targetCurrency =
      presentation.as ??
      (conversions.length > 0 ? null : options.displayCurrency) ??
      null;

    if (
      targetCurrency &&
      displayed.currency &&
      targetCurrency !== displayed.currency
    ) {
      const rate = rates?.rate(displayed.currency, targetCurrency);

      if (rate) {
        conversions.push({ from: displayed.currency, to: targetCurrency });
        displayed = {
          amount: multiply(displayed.amount, rate),
          currency: targetCurrency,
        };
      }
    }
    const show =
      presentation.show ?? defaultShowMode(occurrence.context, name !== null);

    // `show=name` on a bare expression has no name to show, so it falls back to
    // the working rather than rendering a stray leading `=`.
    const labelKind =
      show === "value" ? null : show === "name" && name ? "name" : "expr";

    results.set(occurrence.key, {
      key: occurrence.key,
      label:
        labelKind === null
          ? null
          : labelKind === "name"
            ? name
            : occurrence.expression,
      labelKind,
      value: formatMoney(displayed.amount, displayed.currency, {
        locale: options.locale,
        places: presentation.dp ?? undefined,
      }),
      expression: occurrence.expression,
      state: conversions.length === 0 ? "ok" : fxTable?.stale ? "stale" : "converted",
      message: null,
      // The LAST conversion, not the first: it is the one that produced the
      // currency actually on screen. Showing the first made `{as=USD}` on a
      // CAD total display a EUR->CAD rate beside a USD figure, and a round trip
      // (`(rent in USD) in CAD`) cite the outbound leg for an inbound result.
      // An expression mixing three currencies still has no single honest rate,
      // so only the final hop is claimed.
      provenance:
        conversions.length === 0
          ? null
          : describeConversion(fxTable, conversions[conversions.length - 1]),
    });
  }

  return { results, bindings: [...evaluated.bindings.keys()] };
}


/** One styled span inside a rendered value. */
export type CalcValuePart = {
  className: string;
  text: string;
  /** True for the `=` separator, which is decoration rather than content. */
  decorative?: boolean;
};

export type CalcValueMarkup = {
  rootClassName: string;
  state: CalcRenderState;
  title: string;
  parts: CalcValuePart[];
};

/**
 * Describes a value's rendered structure once, for both surfaces that draw it:
 * the React `CalcValue` component (Read mode) and the CodeMirror widget (Live
 * mode). Keeping the class names and part order in one place is what stops the
 * editor and the page from drifting apart as the markup evolves — and these are
 * public CSS-contract classes, so drift would be a breaking change nobody
 * noticed.
 */
export function calcValueMarkup(resolved: ResolvedCalc): CalcValueMarkup {
  if (resolved.state === "error") {
    return {
      rootClassName: "vault-calc vault-calc-error",
      state: "error",
      title: resolved.message ?? "Could not evaluate.",
      parts: [{ className: "vault-calc-expr", text: resolved.expression }],
    };
  }

  const parts: CalcValuePart[] = [];

  if (resolved.label !== null) {
    parts.push({
      className:
        resolved.labelKind === "name"
          ? "vault-calc-name"
          : "vault-calc-expr",
      text: resolved.label,
    });
    parts.push({ className: "vault-calc-op", text: "=", decorative: true });
  }

  parts.push({ className: "vault-calc-value", text: resolved.value });

  return {
    rootClassName: "vault-calc",
    state: resolved.state,
    // Provenance wins over the bare expression: for a converted value "which
    // rate, from whom, for what day" is the question a reader actually has.
    title: resolved.provenance
      ? `${resolved.expression} — ${resolved.provenance}`
      : resolved.expression,
    parts,
  };
}
