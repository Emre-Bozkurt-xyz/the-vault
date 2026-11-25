/**
 * Markdown blocks as the Live-mode block handle sees them (`⋮⋮` beside the
 * block under the pointer): a heading, a list item with its nested lines, a
 * paragraph, a fenced code block, a table, a quote or callout. Pure line
 * maths over the document's lines, so a block menu action or a drag is one
 * ordinary text edit.
 */

export type BlockKind = "heading" | "list" | "paragraph" | "code" | "table" | "quote";

export type MarkdownBlock = {
  /** 0-based first line. */
  start: number;
  /** One past the last line. */
  end: number;
  kind: BlockKind;
};

export type TurnIntoKind = "text" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "quote" | "callout";

const fence = /^\s{0,3}(`{3,}|~{3,})/;
const listItem = /^(\s*)([-*+]|\d+[.)])\s/;
const heading = /^#{1,6}\s/;

function frontmatterEnd(lines: readonly string[]): number {
  if (lines[0] !== "---") return 0;
  const close = lines.indexOf("---", 1);
  return close > 0 ? close + 1 : 0;
}

function indentOf(line: string): number {
  return line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
}

/** Fenced code ranges (0-based, end exclusive), so lines inside one never count as other blocks. */
function fenceRanges(lines: readonly string[], from: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: { line: number; marker: string } | null = null;
  for (let index = from; index < lines.length; index += 1) {
    const match = lines[index].match(fence);
    if (!match) continue;
    if (!open) open = { line: index, marker: match[1] };
    else if (match[1][0] === open.marker[0] && match[1].length >= open.marker.length) {
      ranges.push([open.line, index + 1]);
      open = null;
    }
  }
  if (open) ranges.push([open.line, lines.length]);
  return ranges;
}

/** The block holding `line` (0-based), or null on a blank line, in frontmatter, or past the end. */
export function findBlock(lines: readonly string[], line: number): MarkdownBlock | null {
  const bodyStart = frontmatterEnd(lines);
  if (line < bodyStart || line >= lines.length) return null;
  const inFence = fenceRanges(lines, bodyStart).find(([start, end]) => line >= start && line < end);
  if (inFence) return { start: inFence[0], end: inFence[1], kind: "code" };

  const text = lines[line];
  if (!text.trim()) return null;
  if (heading.test(text)) return { start: line, end: line + 1, kind: "heading" };

  const isQuote = (value: string) => /^\s{0,3}>/.test(value);
  const isTable = (value: string) => /^\s*\|/.test(value);
  const run = (test: (value: string) => boolean, kind: BlockKind): MarkdownBlock => {
    let start = line;
    let end = line + 1;
    while (start > bodyStart && test(lines[start - 1])) start -= 1;
    while (end < lines.length && test(lines[end])) end += 1;
    return { start, end, kind };
  };
  if (isQuote(text)) return run(isQuote, "quote");
  if (isTable(text)) return run(isTable, "table");

  // A list item owns the more-indented lines under it; a line nested in an
  // item belongs to the nearest item above with less indentation.
  let itemLine = -1;
  for (let index = line; index >= bodyStart; index -= 1) {
    const value = lines[index];
    if (!value.trim()) break;
    if (listItem.test(value) && (index === line || indentOf(value) < indentOf(lines[line]))) {
      itemLine = index;
      break;
    }
    if (!listItem.test(value) && indentOf(value) === 0 && index !== line) break;
  }
  if (itemLine >= 0) {
    const base = indentOf(lines[itemLine]);
    let end = itemLine + 1;
    while (end < lines.length && lines[end].trim() && indentOf(lines[end]) > base) end += 1;
    return { start: itemLine, end, kind: "list" };
  }

  const isProse = (value: string) =>
    Boolean(value.trim()) && !heading.test(value) && !listItem.test(value) && !fence.test(value) && !isQuote(value) && !isTable(value);
  return run(isProse, "paragraph");
}

/** The block's lines turned into another kind (headings, lists and to-dos change the first line; quotes and callouts wrap all). */
export function turnInto(blockLines: readonly string[], kind: TurnIntoKind): string[] {
  const unwrapped = blockLines.map((value) => value.replace(/^\s{0,3}>\s?/, ""));
  const wasCallout = /^\[!\w+\]/.test(unwrapped[0] ?? "");
  const body = wasCallout ? [unwrapped[0].replace(/^\[!\w+\]\s*/, ""), ...unwrapped.slice(1)] : unwrapped;
  const [first = "", ...rest] = body;
  const bare = first.replace(/^#{1,6}\s+/, "").replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX/-]\]\s+)?/, "");
  switch (kind) {
    case "text":
      return [bare, ...rest];
    case "h1":
    case "h2":
    case "h3":
      return [`${"#".repeat(Number(kind[1]))} ${bare}`, ...rest];
    case "bullet":
      return [`- ${bare}`, ...rest];
    case "numbered":
      return [`1. ${bare}`, ...rest];
    case "todo":
      return [`- [ ] ${bare}`, ...rest];
    case "quote":
      return [bare, ...rest].map((value) => `> ${value}`.trimEnd());
    case "callout":
      return [`> [!note] ${bare}`.trimEnd(), ...rest.map((value) => `> ${value}`.trimEnd())];
  }
}

/** Lines with `block` moved so it starts where line `before` was (0-based; `lines.length` = the end). */
export function moveBlock(lines: readonly string[], block: MarkdownBlock, before: number): string[] {
  if (before >= block.start && before <= block.end) return [...lines];
  const moved = lines.slice(block.start, block.end);
  const rest = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  const at = before > block.end ? before - moved.length : before;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** A short random block id for `^anchor` links. */
export function newBlockAnchorId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** The block's existing `^anchor` id, if its last line ends with one. */
export function blockAnchorId(blockLines: readonly string[]): string | null {
  return blockLines[blockLines.length - 1]?.match(/(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/)?.[1] ?? null;
}

/**
 * {@link moveBlock}, keeping Markdown's spacing: a moved block that isn't a
 * list item gets blank lines between it and its new neighbours (or it would
 * merge into the paragraph next to it), and the gap it leaves collapses to
 * one blank line.
 */
export function moveBlockWithSpacing(lines: readonly string[], block: MarkdownBlock, before: number): string[] {
  if (before >= block.start && before <= block.end) return [...lines];
  const moved = lines.slice(block.start, block.end);
  const rest = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  // Close the gap it leaves: two blank lines in a row become one.
  if (block.start < rest.length && !rest[block.start].trim() && (block.start === 0 || !rest[block.start - 1].trim())) {
    rest.splice(block.start, 1);
    if (before > block.start) before -= 1;
  }
  let at = before > block.end ? before - moved.length : before;
  at = Math.max(0, Math.min(at, rest.length));
  const spaced = [...moved];
  if (block.kind !== "list") {
    if (at > 0 && rest[at - 1]?.trim()) spaced.unshift("");
    if (at < rest.length && rest[at]?.trim()) spaced.push("");
  }
  return [...rest.slice(0, at), ...spaced, ...rest.slice(at)];
}
