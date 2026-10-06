/**
 * Pure helpers behind the MCP read tools: document paths, multi-term search
 * with line-level hits, and heading outlines with line numbers. Kept free of
 * `server/` imports so vitest can load them (see `lib/folder-paths.ts`).
 *
 * Every line number here is 1-based, matching `read_document`'s
 * `startLine`/`endLine`, so an agent can go straight from a search hit or an
 * outline entry to a ranged read.
 */

import { extractMarkdownHeadingOptions } from "@/lib/wiki-links";

/**
 * A document's location as an agent should see it: `Folder/Sub/Title`, or just
 * the title at the vault root or when its folder is not visible to the caller.
 */
export function documentPath(folderPath: string | null, title: string): string {
  return folderPath ? `${folderPath}/${title}` : title;
}

/**
 * Splits a search query into lowercase terms. `"quoted phrases"` stay one
 * term; everything else splits on whitespace. Empty input yields no terms.
 */
export function parseSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;

  for (const match of query.matchAll(pattern)) {
    const term = (match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (term) terms.push(term);
  }

  return [...new Set(terms)];
}

export type SearchableDocument = {
  title: string;
  /** Folder display path, or null at the root. */
  folderPath: string | null;
  markdown: string;
};

export type SearchHit = { line: number; text: string };

export type SearchScore = {
  score: number;
  /** Up to `maxHits` body lines containing a term, in document order. */
  hits: SearchHit[];
};

const hitLineLength = 200;

function clipLine(line: string, term: string | undefined): string {
  const collapsed = line.replace(/\s+/g, " ").trim();

  if (collapsed.length <= hitLineLength) {
    return collapsed;
  }

  // Centre the clip on the first term occurrence so the hit stays visible.
  const at = term ? collapsed.toLowerCase().indexOf(term) : -1;
  const start = Math.max(0, Math.min(at - 60, collapsed.length - hitLineLength));
  const clipped = collapsed.slice(start, start + hitLineLength);

  return `${start > 0 ? "…" : ""}${clipped}${start + hitLineLength < collapsed.length ? "…" : ""}`;
}

/**
 * Scores a document against search terms. Every term must appear somewhere —
 * title, folder path, or body — or the document does not match (null). A term
 * in the title weighs most, then the folder path (so "cs101 todo" finds the
 * Todo note inside the CS101 folder), then body occurrences (capped, so one
 * long document cannot drown out a precise title hit).
 */
export function scoreDocument(
  document: SearchableDocument,
  terms: string[],
  maxHits = 3,
): SearchScore | null {
  if (terms.length === 0) {
    return { score: 0, hits: [] };
  }

  const title = document.title.toLowerCase();
  const folderPath = (document.folderPath ?? "").toLowerCase();
  const body = document.markdown.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const inTitle = title.includes(term);
    const inPath = folderPath.includes(term);
    let bodyCount = 0;
    let from = body.indexOf(term);

    while (from !== -1 && bodyCount < 20) {
      bodyCount += 1;
      from = body.indexOf(term, from + term.length);
    }

    if (!inTitle && !inPath && bodyCount === 0) {
      return null;
    }

    score += (inTitle ? 10 : 0) + (title === term ? 5 : 0) + (inPath ? 6 : 0);
    score += Math.min(bodyCount, 10);
  }

  const hits: SearchHit[] = [];
  const lines = document.markdown.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length && hits.length < maxHits; index += 1) {
    const lower = lines[index]!.toLowerCase();
    const term = terms.find((candidate) => lower.includes(candidate));

    if (term) {
      hits.push({ line: index + 1, text: clipLine(lines[index]!, term) });
    }
  }

  return { score, hits };
}

/** A collapsed preview of a document's opening, frontmatter skipped. */
export function documentPreview(markdown: string, length = 200): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const collapsed = body.replace(/\s+/g, " ").trim();

  return collapsed.length > length ? `${collapsed.slice(0, length)}…` : collapsed;
}

export type OutlineHeading = {
  level: number;
  text: string;
  slug: string;
  /** 1-based line of the heading. */
  line: number;
};

/**
 * Heading outline with line numbers. Uses the same fence-aware heading rule as
 * `extractMarkdownHeadingOptions`, and takes text and slugs from it, so slugs
 * match the editor's heading links exactly.
 */
export function outlineWithLines(markdown: string): OutlineHeading[] {
  const headings = extractMarkdownHeadingOptions(markdown);
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headingLines: number[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && /^(#{1,6})\s+(.+?)\s*#*$/.test(line)) {
      headingLines.push(index + 1);
    }
  }

  return headings.map((heading, index) => ({
    ...heading,
    line: headingLines[index] ?? 0,
  }));
}

/** Number of lines in a document, counted the way the line tools count them. */
export function countLines(markdown: string): number {
  return markdown.replace(/\r\n/g, "\n").split("\n").length;
}
