import {
  parseDocumentMetadata,
  stripDocumentFrontmatter,
  type TagCategory,
} from "@/lib/content-metadata";

/**
 * The dictionary extension (`docs/20_DICTIONARY_EXTENSION_PLAN.md`) has no table
 * and no frontmatter key of its own: a definition is a *document* tagged
 * `definition`, whose title is the term, whose `aliases:` are the synonyms, and
 * whose `summary:` is the hover text.
 *
 * This module is the pure half of that — slug constant and preview extraction —
 * and lives in `lib/` rather than `server/` for the reason given atop
 * `lib/folder-paths.ts`: everything under `server/` transitively imports
 * `auth.ts`, which cannot load under vitest.
 */

/**
 * The reserved tag that marks a document as a definition. A tag slug is
 * `[a-z0-9_]` only (`normalizeTagSlug`), so a namespaced `vault:definition` is
 * not expressible; the bare word plus `tags.category = "system"` is what marks
 * it as not-yours-to-invent.
 *
 * The tag may be written in a document's own frontmatter OR inherited from a
 * folder's `default_tags` — and folder-inherited tags exist only in
 * `document_tags`, never in the Markdown (`lib/folder-tags.ts`). So membership
 * is always a database question, never a parse of the document.
 */
export const definitionTagSlug = "definition";

/**
 * The category every reserved tag is stored under, or `undefined` for ordinary
 * user vocabulary. `ensureTags` applies this when it mints a tag row, so a
 * `definition` tag is marked as app-owned however it first arrives — authored in
 * frontmatter, inherited from a folder, or created by an admin.
 */
export function reservedTagCategory(slug: string): TagCategory | undefined {
  return slug === definitionTagSlug ? "system" : undefined;
}

/**
 * Upper bound on the Markdown a hover card receives. Summaries are already
 * capped at 500 by `parseDocumentMetadata`, so this only ever bites the
 * first-paragraph fallback — where it is what keeps a public page's wiki-link
 * payload from carrying whole documents.
 */
const maxPreviewLength = 600;

/**
 * Markdown for a definition's hover card: the authored `summary:` when there is
 * one, else the document's first body block.
 *
 * Returns Markdown rather than plain text — the card renders it — so the
 * fallback keeps a block's lines intact instead of flattening them, letting a
 * definition that opens with a list preview as a list.
 */
export function definitionPreview(markdown: string): string | undefined {
  const summary = parseDocumentMetadata(markdown).summary?.trim();

  if (summary) {
    return truncatePreview(summary);
  }

  const paragraph = firstBodyBlock(markdown);
  return paragraph ? truncatePreview(paragraph) : undefined;
}

/**
 * The first run of consecutive non-blank lines that is actual prose.
 *
 * Skipped outright, because a preview that opens on one of these is worse than
 * no preview: fenced and directive blocks (a card must never open mid-fence),
 * headings and thematic breaks (structure, not content), region markers and
 * standalone transclusions (which would pull a second document into a card that
 * is capped at depth zero), and blockquotes/callouts (an aside about the term
 * rather than the term).
 */
function firstBodyBlock(markdown: string): string | undefined {
  const lines = stripDocumentFrontmatter(markdown)
    .replace(/\r\n/g, "\n")
    .split("\n");
  const block: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      // A blank line ends the block once we have one, and is skipped before.
      if (block.length > 0) {
        break;
      }
      continue;
    }

    if (block.length === 0) {
      const fence = trimmed.match(/^(```+|~~~+|:::+)/);

      if (fence) {
        index = skipFencedBlock(lines, index, fence[1]);
        continue;
      }

      if (isSkippableOpeningLine(trimmed)) {
        continue;
      }
    }

    block.push(line);
  }

  const text = block.join("\n").trim();
  return text || undefined;
}

/**
 * Index of a fenced block's closing line, or the last line when it never
 * closes. `:::name` blocks close on a bare `:::`; ``` and ~~~ close on a run of
 * the same character at least as long as the opener.
 */
function skipFencedBlock(
  lines: string[],
  openIndex: number,
  opener: string,
): number {
  const directive = opener.startsWith(":");
  const char = opener[0];
  const closer = directive
    ? /^:::\s*$/
    : new RegExp(`^${char === "`" ? "`" : "~"}{${opener.length},}\\s*$`);

  for (let index = openIndex + 1; index < lines.length; index += 1) {
    if (closer.test(lines[index].trim())) {
      return index;
    }
  }

  return lines.length;
}

function isSkippableOpeningLine(trimmed: string): boolean {
  return (
    // ATX heading.
    /^#{1,6}\s/.test(trimmed) ||
    // Thematic break.
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    // Blockquote, which covers callouts (`> [!note] …`).
    trimmed.startsWith(">") ||
    // Region markers and any other lone HTML comment.
    /^<!--[\s\S]*-->$/.test(trimmed) ||
    // Standalone document transclusion.
    /^!\[\[[^\]\n]+\]\]$/.test(trimmed)
  );
}

function truncatePreview(value: string): string {
  if (value.length <= maxPreviewLength) {
    return value;
  }

  const clipped = value.slice(0, maxPreviewLength);
  const lastBreak = clipped.search(/\s\S*$/);

  return `${(lastBreak > 0 ? clipped.slice(0, lastBreak) : clipped).trimEnd()}…`;
}
