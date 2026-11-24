import { z } from "zod";

/**
 * Anchoring overlay items to the document's text (`useOverlayAnchors`), so an
 * item drawn over a page (a sticker) sits beside the same words in the editor
 * and on read/public pages, whose spacing differs, and moves with its text
 * when lines are added above it.
 *
 * An anchor is a source line (1-based, with its text so it can be found again
 * after edits) plus the item's vertical offset from that line's top.
 */
export type OverlayAnchor = {
  /** 1-based line in the document's Markdown where the anchor was taken. */
  line: number;
  /** The start of that line's text ({@link anchorText}), to find it again if lines moved. */
  text: string;
  /** Item top minus the line's top, in px. */
  dy: number;
  /**
   * The item's horizontal centre as a share of the overlay's width (0 = left
   * edge, 1 = right edge; beyond is the margin), so it keeps its place beside
   * the text in a narrower or wider column.
   */
  x?: number;
};

/** An {@link OverlayAnchor} in an extension's state schema. */
export const overlayAnchorSchema = z.object({
  line: z.number().int().min(1),
  text: z.string().max(400),
  dy: z.number(),
  x: z.number().optional(),
});

/**
 * Where a surface (the editor, a read page) has laid the document's lines
 * out. Positions are viewport (client) coordinates; the host converts them to
 * the overlay layer's.
 */
export type OverlayAnchorSurface = {
  /**
   * `editor`: the source editor, where items were placed by hand before
   * anchors existed (so legacy positions are taken from it); `page`: a
   * rendered read or public page.
   */
  readonly kind: "editor" | "page";
  /** The Markdown's current lines; line n is index n - 1. */
  lines(): readonly string[];
  /** Viewport y of the top of source line `line`, or null when it isn't on the page. */
  lineTop(line: number): number | null;
  /** The source line at viewport y, or null. */
  lineAt(clientY: number): number | null;
  /**
   * False while the layout down to `line` is only an estimate (editor lines
   * not yet drawn, images still loading).
   */
  measured(line: number): boolean;
  /** Layout changed (resize, images loading, edits): positions must be recomputed. */
  subscribe(onChange: () => void): () => void;
  /** Increases on every change `subscribe` reports. */
  version(): number;
};

/** How much of a line an anchor keeps to find it again. */
export const ANCHOR_TEXT_LIMIT = 160;

export function anchorText(line: string): string {
  return line.slice(0, ANCHOR_TEXT_LIMIT);
}

/**
 * The line an anchor points at now: the recorded line if it still holds the
 * recorded text, else the only line that does, else the recorded line
 * clamped into the document (the text was edited; its old place is the best
 * guess).
 */
export function resolveAnchorLine(lines: readonly string[], anchor: Pick<OverlayAnchor, "line" | "text">): number {
  const count = Math.max(1, lines.length);
  const recorded = Math.min(Math.max(Math.round(anchor.line), 1), count);
  const text = anchorText(anchor.text);
  if (anchorText(lines[recorded - 1] ?? "") === text) return recorded;
  // An empty line matches too much to search by.
  if (!text.trim()) return recorded;

  let match = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (anchorText(lines[index]) !== text) continue;
    if (match) return recorded; // Ambiguous: two identical lines.
    match = index + 1;
  }
  return match || recorded;
}

export function isOverlayAnchor(value: unknown): value is OverlayAnchor {
  const anchor = value as OverlayAnchor | null;
  return (
    typeof anchor?.line === "number" &&
    typeof anchor.text === "string" &&
    typeof anchor.dy === "number" &&
    Number.isFinite(anchor.line) &&
    Number.isFinite(anchor.dy)
  );
}
