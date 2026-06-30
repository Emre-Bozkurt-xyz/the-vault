import type * as Y from "yjs";

import { slugify } from "@/lib/slug";

export type AnchoredEdit = { oldString: string; newString: string };

function truncate(value: string, length = 60): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > length ? `${collapsed.slice(0, length)}…` : collapsed;
}

/**
 * Applies anchored search/replace edits to a Y.Text in offset order. Each
 * `oldString` must appear exactly once in the current text (the staleness guard:
 * 0 matches → re-read, >1 → ambiguous). Edits must not overlap. Applied from the
 * highest offset down so earlier offsets stay valid; the caller is expected to
 * wrap this in a single `ydoc.transact`.
 */
export function applyAnchoredEdits(ytext: Y.Text, edits: AnchoredEdit[]): number {
  const text = ytext.toString();

  const resolved = edits.map((edit) => {
    if (edit.oldString.length === 0) {
      throw new Error("old_string must not be empty.");
    }

    const index = text.indexOf(edit.oldString);

    if (index === -1) {
      throw new Error(
        `Anchor not found — re-read the section. old_string: "${truncate(edit.oldString)}"`,
      );
    }

    if (text.indexOf(edit.oldString, index + 1) !== -1) {
      throw new Error(
        `Anchor is ambiguous (matches more than once) — include more surrounding context. old_string: "${truncate(edit.oldString)}"`,
      );
    }

    return { index, length: edit.oldString.length, newString: edit.newString };
  });

  const ordered = [...resolved].sort((a, b) => a.index - b.index);

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;

    if (current.index < previous.index + previous.length) {
      throw new Error("Edits overlap; apply them in separate calls.");
    }
  }

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const op = ordered[i]!;
    ytext.delete(op.index, op.length);
    ytext.insert(op.index, op.newString);
  }

  return ordered.length;
}

/** Appends markdown to the end of the document, ensuring a separating newline. */
export function appendMarkdown(ytext: Y.Text, markdown: string): void {
  const text = ytext.toString();
  const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  ytext.insert(ytext.length, `${separator}${markdown}`);
}

export type HeadingInsertPosition = "section_start" | "section_end";

/**
 * Inserts markdown into the section owned by the heading matching `heading`
 * (by text or slug). `section_start` places it just after the heading line;
 * `section_end` places it at the end of the section (before the next same/higher
 * heading, or end of document). Returns false when no heading matches.
 */
export function insertAtHeading(
  ytext: Y.Text,
  heading: string,
  markdown: string,
  position: HeadingInsertPosition,
): boolean {
  const text = ytext.toString();
  const section = findHeadingSection(text, heading);

  if (!section) {
    return false;
  }

  if (position === "section_start") {
    const block = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
    ytext.insert(section.bodyStart, block);
    return true;
  }

  const before = text.slice(0, section.end);
  const separator = before.endsWith("\n") ? "" : "\n";
  const trailing = markdown.endsWith("\n") ? "" : "\n";
  ytext.insert(section.end, `${separator}${markdown}${trailing}`);
  return true;
}

type HeadingSection = {
  /** Char offset of the heading line start. */
  headingStart: number;
  /** Char offset just after the heading line's trailing newline. */
  bodyStart: number;
  /** Char offset where the section ends (next same/higher heading or EOF). */
  end: number;
};

/**
 * Locates the section for a heading, fence-aware so `#` inside a code block is
 * never treated as a heading. Offsets are character indices into `text`.
 */
function findHeadingSection(text: string, target: string): HeadingSection | null {
  const lines = text.split("\n");
  const normalized = target.trim().toLowerCase();
  const targetSlug = slugify(target);

  let offset = 0;
  let inFence = false;
  let headingStart = -1;
  let bodyStart = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineStart = offset;
    // +1 for the "\n" that split() removed (every line except possibly the last
    // is followed by one; using lineLength+1 consistently is fine for offsets
    // within the joined string because we reconstruct from the same split).
    offset += line.length + 1;

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);

    if (!heading) {
      continue;
    }

    const level = heading[1]!.length;
    const headingText = heading[2]!.trim();

    if (headingStart === -1) {
      if (
        headingText.toLowerCase() === normalized ||
        slugify(headingText) === targetSlug
      ) {
        headingStart = lineStart;
        bodyStart = Math.min(lineStart + line.length + 1, text.length);
        headingLevel = level;
      }
      continue;
    }

    if (level <= headingLevel) {
      return { headingStart, bodyStart, end: lineStart };
    }
  }

  if (headingStart === -1) {
    return null;
  }

  return { headingStart, bodyStart, end: text.length };
}
