/**
 * Maps lines of the Markdown a document renders (after asset embeds and
 * groups were expanded into HTML) back to the author's source lines, so read
 * pages can tag blocks with the line the editor shows (`data-source-line`,
 * overlay anchoring).
 *
 * Expansions are local: a line either renders as its own transform, or a run
 * of lines (an asset group) became a run of different lines. This walks both
 * texts, matching lines, and after a rewritten run resyncs at the nearest
 * line that matches again; every rendered line inside the run maps to the
 * run's first source line.
 *
 * Returns `map[renderedIndex] = sourceIndex` (both 0-based).
 */
export function mapRenderedLinesToSource(
  sourceLines: readonly string[],
  renderedLines: readonly string[],
  transformLine: (line: string) => string = (line) => line,
): number[] {
  const expected = sourceLines.map(transformLine);
  const map = new Array<number>(renderedLines.length);
  const window = 400;
  let s = 0;
  let r = 0;

  while (r < renderedLines.length) {
    if (s < expected.length && renderedLines[r] === expected[s]) {
      map[r] = s;
      r += 1;
      s += 1;
      continue;
    }

    // Resync: the closest pair of lines (fewest skipped on both sides) that
    // match again. Blank lines match too much to resync on.
    let best: { dr: number; ds: number } | null = null;
    for (let total = 1; total <= window && !best; total += 1) {
      for (let dr = 0; dr <= total; dr += 1) {
        const ds = total - dr;
        const ri = r + dr;
        const si = s + ds;
        if (ri >= renderedLines.length || si >= expected.length) continue;
        if (renderedLines[ri] === expected[si] && renderedLines[ri].trim()) {
          best = { dr, ds };
          break;
        }
      }
    }

    const runStart = Math.min(s, Math.max(0, expected.length - 1));
    if (!best) {
      for (; r < renderedLines.length; r += 1) map[r] = runStart;
      break;
    }
    for (let index = 0; index < best.dr; index += 1) map[r + index] = runStart;
    r += best.dr;
    s += best.ds;
  }

  return map;
}
