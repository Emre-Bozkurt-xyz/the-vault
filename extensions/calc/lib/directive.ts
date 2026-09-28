/**
 * How a `:calc` value is shown: the `{show=… dp=… as=…}` attributes.
 *
 * Boundary: `./` engine modules own *meaning* (parse, evaluate, unit algebra)
 * and know nothing about Markdown. The host finds occurrences and hands over
 * their raw source and parsed attributes (`docs/23_EXTENSION_SDK_PLAN.md` §6):
 * everything inside `[…]` goes to the evaluator, everything inside `{…}` is
 * read here.
 */

/** The directive name, i.e. `:calc[…]` and `:::calc`. */
export const CALC_DIRECTIVE_NAME = "calc";

// ---------------------------------------------------------------------------
// Presentation attributes
// ---------------------------------------------------------------------------

/** How a result is shown. `name` falls back to `expr` on a non-binding. */
export type CalcShowMode = "value" | "name" | "expr";

export type CalcPresentation = {
  show: CalcShowMode | null;
  /** Display decimal places. NEVER affects the stored value — see below. */
  dp: number | null;
  /** Display currency for this one value. */
  as: string | null;
};

export const EMPTY_PRESENTATION: CalcPresentation = {
  show: null,
  dp: null,
  as: null,
};

const SHOW_MODES = new Set<CalcShowMode>(["value", "name", "expr"]);

/** Upper bound on `dp`, matching the evaluator's `round()` ceiling. */
const MAX_DISPLAY_PLACES = 20;

/**
 * Reads `{show=… dp=… as=…}`.
 *
 * `dp` is **display-only and must never change the bound value**. If
 * `:calc[rate = 1/3]{dp=2}` bound `0.33`, every downstream total would drift and
 * the error would be invisible where it was introduced. `round(x, 2)` changes the
 * value and propagates; `{dp=2}` changes one rendering and propagates to nothing.
 *
 * Unknown keys and unparseable values are ignored rather than fatal: a typo in a
 * display hint should never turn a correct figure into an error chip.
 */
export function parseCalcPresentation(
  attributes: Record<string, string | null | undefined> | null | undefined,
): CalcPresentation {
  if (!attributes) {
    return EMPTY_PRESENTATION;
  }

  const rawShow = attributes.show?.trim().toLowerCase();
  const rawDp = attributes.dp?.trim();
  const rawAs = attributes.as?.trim().toUpperCase();

  const dp = rawDp !== undefined && /^\d+$/.test(rawDp) ? Number(rawDp) : null;

  return {
    show:
      rawShow && SHOW_MODES.has(rawShow as CalcShowMode)
        ? (rawShow as CalcShowMode)
        : null,
    dp: dp !== null && dp <= MAX_DISPLAY_PLACES ? dp : null,
    as: rawAs && /^[A-Z]{3}$/.test(rawAs) ? rawAs : null,
  };
}
