/**
 * Lightweight scanner for inline `:calc[…]` occurrences, for the CodeMirror
 * Live-mode decorations.
 *
 * Read mode locates occurrences by parsing the document with remark
 * (`lib/markdown/calc-directive.ts`), which is exact but far too expensive to
 * repeat on every keystroke. This is the editor's equivalent: one regex pass
 * over the raw text, plus an exclusion callback the caller fills from
 * CodeMirror's syntax tree.
 *
 * The scan is exact rather than approximate because the calc grammar contains
 * no brackets or braces at all (see `lib/calc/tokenizer.ts`), so the first `]`
 * always ends the expression and the first `}` always ends the attributes.
 *
 * `lib/calc/scan.test.ts` asserts this agrees with the remark collector on a
 * shared corpus — the two must find the same occurrences in the same order, or
 * a value would render differently in the editor than on the page.
 */

/** A `:calc[…]{…}` occurrence located in raw text. */
export type CalcScanMatch = {
  /** Offset of the leading `:`. */
  from: number;
  /** Offset just past the final `]` or `}`. */
  to: number;
  /** Raw expression source, from between the brackets. */
  expression: string;
  /** Raw attribute source, or null when no `{…}` group followed. */
  attributes: string | null;
};

const INLINE_CALC = /:calc\[([^\]\n]*)\](?:\{([^}\n]*)\})?/g;

/**
 * Finds inline occurrences in document order.
 *
 * `isExcluded` should report ranges the directive must not be recognized in —
 * fenced code and inline code, so a document can show the syntax without
 * evaluating it. Without it every match is accepted.
 */
export function scanInlineCalc(
  text: string,
  isExcluded?: (from: number, to: number) => boolean,
): CalcScanMatch[] {
  const matches: CalcScanMatch[] = [];

  INLINE_CALC.lastIndex = 0;

  for (const match of text.matchAll(INLINE_CALC)) {
    const from = match.index;

    if (from === undefined) {
      continue;
    }

    // A backslash escapes the directive, matching the generic directive syntax.
    if (from > 0 && text[from - 1] === "\\") {
      continue;
    }

    const to = from + match[0].length;

    if (isExcluded?.(from, to)) {
      continue;
    }

    matches.push({
      from,
      to,
      expression: match[1] ?? "",
      attributes: match[2] ?? null,
    });
  }

  return matches;
}

/** Line-level `:::calc` fence, for locating declaration blocks in raw text. */
const CALC_BLOCK_OPEN = /^:::calc(?:\{([^}\n]*)\})?\s*$/i;
const CALC_BLOCK_CLOSE = /^:::\s*$/;

/**
 * One statement line inside a block, located in the document.
 *
 * Live mode decorates the statement lines in place rather than replacing the
 * block with one opaque widget, so it needs each line's own offsets — a widget
 * covering the whole block gives CodeMirror nothing to map a click onto but the
 * block's two ends.
 */
export type CalcBlockStatement = {
  /** 1-based, to match CodeMirror. */
  line: number;
  /** Offset of the line's first character. */
  from: number;
  /** Offset just past the line's last character. */
  to: number;
  /** The trimmed statement source. */
  source: string;
};

export type CalcBlockScan = {
  /** Offset of the opening fence's first character. */
  from: number;
  /** Offset of the end of the closing fence (or the document end). */
  to: number;
  startLine: number;
  endLine: number;
  /** False when the block runs to the end of the document unterminated. */
  closed: boolean;
  attributes: string | null;
  /** Statement sources, blank lines dropped. */
  lines: string[];
  /** The same statements, with their positions. */
  statements: CalcBlockStatement[];
};

/**
 * Finds `:::calc` blocks in raw text, skipping fenced code.
 *
 * Line numbers are 1-based to match CodeMirror's.
 */
export function scanCalcBlocks(text: string): CalcBlockScan[] {
  const lines = text.split("\n");
  const blocks: CalcBlockScan[] = [];

  // Offset of the first character of each line.
  const offsets: number[] = [];
  let cursor = 0;

  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  let codeFence: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (codeFence) {
      if (fence && line.trim().startsWith(codeFence)) {
        codeFence = null;
      }
      index += 1;
      continue;
    }

    if (fence) {
      codeFence = fence[1];
      index += 1;
      continue;
    }

    const open = CALC_BLOCK_OPEN.exec(line.trim());

    if (!open) {
      index += 1;
      continue;
    }

    const startLine = index;
    const statements: CalcBlockStatement[] = [];
    index += 1;

    while (index < lines.length && !CALC_BLOCK_CLOSE.test(lines[index].trim())) {
      const statement = lines[index].trim();

      if (statement) {
        statements.push({
          line: index + 1,
          from: offsets[index],
          to: offsets[index] + lines[index].length,
          source: statement,
        });
      }

      index += 1;
    }

    const closed = index < lines.length;
    const endLine = Math.min(index, lines.length - 1);

    blocks.push({
      from: offsets[startLine],
      to: offsets[endLine] + lines[endLine].length,
      startLine: startLine + 1,
      endLine: endLine + 1,
      closed,
      attributes: open[1] ?? null,
      lines: statements.map((statement) => statement.source),
      statements,
    });

    index += 1;
  }

  return blocks;
}
