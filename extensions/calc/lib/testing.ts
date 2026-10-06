/**
 * Test helpers: calc documents built the way the host builds them.
 *
 * Tests describe a document as ordered pieces (runs of Markdown and `:::calc`
 * blocks), as the renderer numbers them, and read results back by
 * `calcKey(piece, n)`. Markdown pieces go through the host's own occurrence
 * collector, so what a test sees is what a page renders.
 */
import type { AnalyzableDocument, ExtensionOccurrence } from "@/lib/extension-api";
import { collectOccurrences } from "@/lib/extension-api/markdown";

import manifest from "../manifest";
import { parseCalcPresentation, type CalcPresentation } from "./directive";
import { buildCalcDocument, calcBlockStatements, isCollapsed } from "./document";

export type CalcPiece =
  | { type: "markdown"; markdown: string }
  | {
      type: "calc-block";
      lines: Array<{ expression: string }>;
      presentation: CalcPresentation;
      collapsed: boolean;
    };

/** Result key of the `index`th value of piece `pieceIndex`. */
export function calcKey(pieceIndex: number, index: number): string {
  return `${pieceIndex}:${index}`;
}

function presentationAttributes(
  presentation: CalcPresentation,
  collapsed: boolean,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (presentation.show) attributes.show = presentation.show;
  if (presentation.dp !== null) attributes.dp = String(presentation.dp);
  if (presentation.as) attributes.as = presentation.as;
  if (collapsed) attributes.collapsed = "";
  return attributes;
}

export function occurrencesFromPieces(
  pieces: readonly CalcPiece[],
  markdown = "",
): AnalyzableDocument {
  const occurrences: ExtensionOccurrence[] = pieces.flatMap((piece, pieceIndex) => {
    if (piece.type === "calc-block") {
      return [
        {
          kind: "block" as const,
          key: String(pieceIndex),
          name: "calc",
          source: ":::calc",
          body: piece.lines.map((line) => line.expression).join("\n"),
          attributes: presentationAttributes(piece.presentation, piece.collapsed),
        },
      ];
    }

    return collectOccurrences(piece.markdown, manifest).occurrences.map((found) => ({
      ...found,
      key: `${pieceIndex}:${found.key.split(":")[1]}`,
    }));
  });

  return { markdown, occurrences };
}

export function buildFromPieces(
  pieces: readonly CalcPiece[],
  options?: Parameters<typeof buildCalcDocument>[1],
) {
  return buildCalcDocument(occurrencesFromPieces(pieces), options);
}

/** A Markdown run's inline `:calc` values, as calc reads them. */
export function collectInlineCalc(
  markdown: string,
): Array<{ expression: string | null; presentation: CalcPresentation }> {
  return collectOccurrences(markdown, manifest).occurrences.flatMap((found) =>
    found.kind === "inline"
      ? [{ expression: found.label, presentation: parseCalcPresentation(found.attributes) }]
      : [],
  );
}

/** A document's `:::calc` blocks, as calc reads them. */
export function collectCalcBlocks(
  markdown: string,
): Array<{ lines: string[]; presentation: CalcPresentation; collapsed: boolean }> {
  return collectOccurrences(markdown, manifest).occurrences.flatMap((found) =>
    found.kind === "block"
      ? [
          {
            lines: calcBlockStatements(found.body),
            presentation: parseCalcPresentation(found.attributes),
            collapsed: isCollapsed(found.attributes),
          },
        ]
      : [],
  );
}
