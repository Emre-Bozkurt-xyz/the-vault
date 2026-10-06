/**
 * Builds the render model for a document's `:calc` values from the host's
 * occurrences (`docs/23_EXTENSION_SDK_PLAN.md` §6 "Pre-pass").
 *
 * The host hands over every `:calc[…]` and `:::calc` block in document order,
 * and this module walks them once, evaluating each against the names bound
 * above it. Components then only look results up; they never evaluate, so a
 * figure cannot differ between two places that render the same document.
 *
 * ## Keys
 *
 * An inline value's key is its occurrence key. A block binds one statement per
 * non-blank body line, keyed `<occurrence key>:<row>`.
 *
 * ## Scope
 *
 * One rendered document. Wiki-embedded documents and foldable regions render as
 * their own documents and therefore get their own scope, which for an embed is
 * correct (its names should not leak into the host) and for a region is a
 * *limitation*: a name defined outside a region is not visible inside it. It
 * fails loudly as `unknown-name` (a visible error chip), never as a silently
 * wrong number.
 */

import type { AnalyzableDocument } from "@/lib/extension-api";
import type { FxRateTable } from "@/lib/extension-api/fx";

import { parseCalcPresentation } from "./directive";
import {
  resolveCalcOccurrences,
  type CalcDocument,
  type CalcOccurrence,
} from "./resolve";
import type { RateResolver } from "./types";

export {
  EMPTY_CALC_DOCUMENT,
  resolveCalcOccurrences,
  type CalcDocument,
  type CalcOccurrence,
  type CalcRenderState,
  type ResolvedCalc,
} from "./resolve";

/** The key of row `row` of the block with occurrence key `blockKey`. */
export function calcRowKey(blockKey: string, row: number): string {
  return `${blockKey}:${row}`;
}

/** A block body's statements: its non-blank lines, trimmed. */
export function calcBlockStatements(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Whether a `:::calc{…}` block opens folded. */
export function isCollapsed(attributes: Record<string, string>): boolean {
  return Object.hasOwn(attributes, "collapsed");
}

export function buildCalcDocument(
  document: Pick<AnalyzableDocument, "occurrences">,
  options: {
    rates?: RateResolver;
    locale?: string;
    fxTable?: FxRateTable | null;
    displayCurrency?: string | null;
  } = {},
): CalcDocument {
  const occurrences: CalcOccurrence[] = [];

  for (const found of document.occurrences) {
    const presentation = parseCalcPresentation(found.attributes);

    if (found.kind === "inline") {
      occurrences.push({
        key: found.key,
        // A `:calc` with no bracket group evaluates the empty expression,
        // which reports "Expression is empty" rather than vanishing.
        expression: found.label ?? "",
        presentation,
        context: "inline",
      });
      continue;
    }

    calcBlockStatements(found.body).forEach((expression, row) => {
      occurrences.push({
        key: calcRowKey(found.key, row),
        expression,
        presentation,
        context: "block",
      });
    });
  }

  return resolveCalcOccurrences(occurrences, options);
}
