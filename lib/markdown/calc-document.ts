/**
 * Builds the render model for a document's `:calc` values.
 *
 * A document is split into ordered *pieces* — runs of markdown and `:::calc`
 * blocks — and this module walks them once, in order, evaluating every
 * occurrence against the names bound above it. The renderer then only looks
 * results up; it never evaluates, so a figure cannot differ between two places
 * that render the same document.
 *
 * ## Keys
 *
 * `"<pieceIndex>:<n>"`, where `n` is the occurrence's ordinal *within* its piece.
 * Ordinals rather than character offsets on purpose: `MarkdownSegment` rewrites
 * wiki links and asset embeds into HTML before the markdown is parsed for
 * rendering, which shifts every offset but cannot add or remove a `:calc`
 * occurrence. Ordinals survive that; offsets would not.
 *
 * ## Scope
 *
 * One `MarkdownDocument` render. Wiki-embedded documents recurse into their own
 * `MarkdownDocument` and therefore get their own scope, which is correct — an
 * embedded document's names should not leak into its host. Foldable regions do
 * the same, which is a *limitation* rather than a design goal: a name defined
 * outside a region is not visible inside it. It fails loudly as `unknown-name`
 * (a visible error chip), never as a silently wrong number.
 */

import type { FxRateTable } from "@/lib/calc/fx";
import {
  resolveCalcOccurrences,
  type CalcOccurrence,
  type CalcDocument,
} from "@/lib/calc/resolve";
import type { RateResolver } from "@/lib/calc/types";
import {
  collectInlineCalcOccurrences,
  splitCalcBlockSegments,
  type CalcBlockLine,
  type CalcPresentation,
} from "@/lib/markdown/calc-directive";

// Re-exported so existing importers keep one entry point for the render model.
export {
  resolveCalcOccurrences,
  type CalcDocument,
  type CalcOccurrence,
  type CalcRenderState,
  type ResolvedCalc,
} from "@/lib/calc/resolve";

export type CalcPiece =
  | { type: "markdown"; markdown: string }
  | {
      type: "calc-block";
      lines: CalcBlockLine[];
      presentation: CalcPresentation;
      collapsed: boolean;
    };

export const EMPTY_CALC_DOCUMENT: CalcDocument = {
  results: new Map(),
  bindings: [],
};

export function calcKey(pieceIndex: number, index: number): string {
  return `${pieceIndex}:${index}`;
}

export function buildCalcDocument(
  pieces: readonly CalcPiece[],
  options: {
    rates?: RateResolver;
    locale?: string;
    fxTable?: FxRateTable | null;
    displayCurrency?: string | null;
  } = {},
): CalcDocument {
  const occurrences: CalcOccurrence[] = [];

  pieces.forEach((piece, pieceIndex) => {
    if (piece.type === "markdown") {
      collectInlineCalcOccurrences(piece.markdown).forEach((found, index) => {
        occurrences.push({
          key: calcKey(pieceIndex, index),
          // A `:calc` with no bracket group evaluates the empty expression,
          // which reports "Expression is empty" rather than vanishing.
          expression: found.expression ?? "",
          presentation: found.presentation,
          context: "inline",
        });
      });

      return;
    }

    piece.lines.forEach((line, index) => {
      occurrences.push({
        key: calcKey(pieceIndex, index),
        expression: line.expression,
        presentation: piece.presentation,
        context: "block",
      });
    });
  });

  return resolveCalcOccurrences(occurrences, options);
}


/**
 * Splits raw markdown into calc pieces.
 *
 * For callers that hold only text — agent actions, tests — rather than the
 * component tree `MarkdownDocument` walks. Calendar and wiki-embed splitting is
 * skipped deliberately: neither changes the order `:calc` occurrences appear in,
 * and order is the only thing that affects binding.
 */
export function calcPiecesFromMarkdown(markdown: string): CalcPiece[] {
  return splitCalcBlockSegments(markdown).map((segment) =>
    segment.type === "markdown"
      ? { type: "markdown", markdown: segment.markdown }
      : {
          type: "calc-block",
          lines: segment.lines,
          presentation: segment.presentation,
          collapsed: segment.collapsed,
        },
  );
}
