/**
 * Line-level directive blocks: single-line `:::name{…}` (leaf) and
 * `:::name{…}` … `:::` (container), for whichever names the caller claims.
 *
 * One scanner for every consumer — Read-mode splitting, the Live-mode engine,
 * the `:::` menu and extensions (through `@/lib/extension-api`) — so they can
 * never disagree about where a block starts or ends. Pure and isomorphic: it
 * knows nothing about which extension owns a name.
 *
 * Fenced code is skipped, so a document can show the syntax without it becoming
 * a block. A container without its closing `:::` runs to the end of the text
 * rather than discarding what it holds.
 */

/** Lowercase directive names the caller wants recognised, by block form. */
export type DirectiveBlockClaims = {
  leaf: ReadonlySet<string>;
  container: ReadonlySet<string>;
};

const DIRECTIVE_LINE = /^:::\s*([a-z][\w-]*)\s*(?:\{([^}\n]*)\})?\s*$/i;
const CONTAINER_CLOSE = /^:::\s*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATTRIBUTE =
  /([A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g;

/** `key=value key="v" flag` → `{ key: "value", key: "v", flag: "" }`. */
export function parseDirectiveAttributes(
  raw: string | null | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!raw) return attributes;

  for (const match of raw.matchAll(ATTRIBUTE)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

/** A claimed block found on 0-based line indices of the scanned text. */
export type DirectiveBlockMatch = {
  form: "leaf" | "container";
  /** Lowercase directive name. */
  name: string;
  attributes: Record<string, string>;
  /** The opening line, trimmed. */
  source: string;
  /** Index of the opening line. */
  start: number;
  /** Index of the closing `:::` (or the last line, when unclosed); `start` for a leaf. */
  end: number;
  /** False for a container that runs to the end unterminated. Always true for a leaf. */
  closed: boolean;
};

/** Every claimed block in `lines`, in order. */
export function scanDirectiveBlockLines(
  lines: readonly string[],
  claims: DirectiveBlockClaims,
): DirectiveBlockMatch[] {
  const matches: DirectiveBlockMatch[] = [];

  if (claims.leaf.size === 0 && claims.container.size === 0) {
    return matches;
  }

  let openFence: { marker: string; length: number } | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = CODE_FENCE.exec(line);

    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence.marker &&
        fence[1].length >= openFence.length &&
        !fence[2].trim()
      ) {
        openFence = null;
      }
      index += 1;
      continue;
    }

    if (fence) {
      openFence = { marker: fence[1][0], length: fence[1].length };
      index += 1;
      continue;
    }

    const trimmed = line.trim();
    const directive = DIRECTIVE_LINE.exec(trimmed);
    const name = directive?.[1].toLowerCase();

    if (directive && name && claims.leaf.has(name)) {
      matches.push({
        form: "leaf",
        name,
        attributes: parseDirectiveAttributes(directive[2]),
        source: trimmed,
        start: index,
        end: index,
        closed: true,
      });
      index += 1;
      continue;
    }

    if (directive && name && claims.container.has(name)) {
      const start = index;
      index += 1;

      while (index < lines.length && !CONTAINER_CLOSE.test(lines[index].trim())) {
        index += 1;
      }

      const closed = index < lines.length;
      matches.push({
        form: "container",
        name,
        attributes: parseDirectiveAttributes(directive[2]),
        source: trimmed,
        start,
        end: closed ? index : lines.length - 1,
        closed,
      });
      index += 1;
      continue;
    }

    index += 1;
  }

  return matches;
}

export type DirectiveBlockSegment =
  | { type: "markdown"; markdown: string; startLine: number }
  | {
      type: "leaf";
      name: string;
      attributes: Record<string, string>;
      source: string;
    }
  | {
      type: "container";
      name: string;
      attributes: Record<string, string>;
      /** The opening line, trimmed. */
      source: string;
      /** The lines between the fences, as written. */
      body: string;
    };

/**
 * Splits Markdown into runs of plain Markdown and claimed blocks, so a renderer
 * can mount each block where it sits.
 */
export function splitDirectiveBlocks(
  markdown: string,
  claims: DirectiveBlockClaims,
): DirectiveBlockSegment[] {
  const lines = markdown.split(/\r?\n/);
  const matches = scanDirectiveBlockLines(lines, claims);

  if (matches.length === 0) {
    return [{ type: "markdown", markdown, startLine: 0 }];
  }

  const segments: DirectiveBlockSegment[] = [];
  let cursor = 0;

  const flush = (until: number) => {
    if (until > cursor) {
      segments.push({ type: "markdown", markdown: lines.slice(cursor, until).join("\n"), startLine: cursor });
    }
  };

  for (const match of matches) {
    flush(match.start);

    if (match.form === "leaf") {
      segments.push({
        type: "leaf",
        name: match.name,
        attributes: match.attributes,
        source: match.source,
      });
    } else {
      segments.push({
        type: "container",
        name: match.name,
        attributes: match.attributes,
        source: match.source,
        body: lines
          .slice(match.start + 1, match.closed ? match.end : match.end + 1)
          .join("\n"),
      });
    }

    cursor = match.end + 1;
  }

  flush(lines.length);
  return segments;
}

/** One body line of a container, positioned in the scanned text. */
export type ContainerBodyLine = {
  /** 1-based, to match CodeMirror. */
  line: number;
  /** Offset of the line's first character. */
  from: number;
  /** Offset just past the line's last character. */
  to: number;
  text: string;
};

/** A container block located in text, in CodeMirror's coordinates. */
export type ContainerBlockScan = {
  name: string;
  attributes: Record<string, string>;
  /** Offset of the opening fence's first character. */
  from: number;
  /** End of the closing fence (or of the text, when unclosed). */
  to: number;
  /** 1-based line of the opening fence. */
  startLine: number;
  /** 1-based line of the closing fence (or the last line, when unclosed). */
  endLine: number;
  closed: boolean;
  body: ContainerBodyLine[];
};

/** Container blocks with one of `names` in `text`, in order (Live mode). */
export function scanContainerBlocks(
  text: string,
  names: Iterable<string>,
): ContainerBlockScan[] {
  const container = new Set([...names].map((name) => name.toLowerCase()));
  const lines = text.split("\n");
  const offsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  return scanDirectiveBlockLines(lines, { leaf: new Set(), container }).map(
    (match) => {
      const bodyEnd = match.closed ? match.end : match.end + 1;
      const body: ContainerBodyLine[] = [];

      for (let index = match.start + 1; index < bodyEnd; index += 1) {
        body.push({
          line: index + 1,
          from: offsets[index],
          to: offsets[index] + lines[index].length,
          text: lines[index],
        });
      }

      return {
        name: match.name,
        attributes: match.attributes,
        from: offsets[match.start],
        to: offsets[match.end] + lines[match.end].length,
        startLine: match.start + 1,
        endLine: match.end + 1,
        closed: match.closed,
        body,
      };
    },
  );
}

/**
 * True when 1-based `line` falls inside one of these containers, counting the
 * closing fence but not the opening one. That is the line where a `:::` means
 * "close this block", so the `:::` menu must stay shut there.
 */
export function isInsideContainerBlock(
  text: string,
  line: number,
  names: Iterable<string>,
): boolean {
  return scanContainerBlocks(text, names).some(
    (block) => line > block.startLine && line <= block.endLine,
  );
}
