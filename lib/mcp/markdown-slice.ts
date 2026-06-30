import { slugify } from "@/lib/slug";

/**
 * Returns the 1-based inclusive line range `[startLine, endLine]` of a markdown
 * document. `endLine` omitted means "to the end".
 */
export function sliceMarkdownByLineRange(
  markdown: string,
  startLine: number,
  endLine?: number,
): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = Math.max(1, Math.floor(startLine)) - 1;
  const end = endLine ? Math.min(lines.length, Math.floor(endLine)) : lines.length;

  return lines.slice(start, Math.max(start, end)).join("\n");
}

/**
 * Returns the section of a markdown document beginning at the heading whose text
 * or slug matches `target`, up to (but excluding) the next heading of the same or
 * higher level. Returns `null` when no heading matches. Fenced code blocks are
 * skipped so a `#` inside a fence is never treated as a heading.
 */
export function sliceMarkdownByHeading(
  markdown: string,
  target: string,
): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalized = target.trim().toLowerCase();
  const targetSlug = slugify(target);

  let startIndex = -1;
  let startLevel = 0;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

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
    const text = heading[2]!.trim();

    if (startIndex === -1) {
      if (text.toLowerCase() === normalized || slugify(text) === targetSlug) {
        startIndex = index;
        startLevel = level;
      }
      continue;
    }

    if (level <= startLevel) {
      return lines.slice(startIndex, index).join("\n");
    }
  }

  if (startIndex === -1) {
    return null;
  }

  return lines.slice(startIndex).join("\n");
}
