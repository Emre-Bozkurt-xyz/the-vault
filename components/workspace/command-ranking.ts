// Relevance ranking for the Ctrl/Cmd+K command palette's command mode. Kept in
// its own module (no React imports) so it is unit-testable and so the slash
// menu and the palette share the same ranking *philosophy*: exact match beats
// a token prefix, which beats a word-boundary hit, which beats a loose
// substring, which beats a keyword-only match. The slash menu delegates the
// same idea to CodeMirror's built-in fuzzy scorer.

export type RankableCommand = {
  /** Canonical `/token` (without the slash). */
  slug: string;
  label: string;
  group: string;
  /** Space-separated extra search terms. */
  keywords: string;
};

/** Term not found anywhere in the command → the command is excluded. */
const NO_MATCH = Number.NEGATIVE_INFINITY;

/**
 * Filters `commands` to those matching every whitespace-separated term in
 * `query`, ranked most-relevant first. An empty query returns `commands`
 * unchanged (the browse ordering). The sort is stable, so equally-scored
 * commands keep their declaration order.
 */
export function rankCommands<T extends RankableCommand>(
  commands: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return commands;
  }

  const terms = normalized.split(/\s+/).filter(Boolean);

  return commands
    .map((command) => ({ command, score: scoreCommand(command, terms, normalized) }))
    .filter((entry) => entry.score > NO_MATCH)
    .sort((first, second) => second.score - first.score)
    .map((entry) => entry.command);
}

function scoreCommand(
  command: RankableCommand,
  terms: string[],
  query: string,
): number {
  const slug = command.slug.toLowerCase();
  const label = command.label.toLowerCase();
  const group = command.group.toLowerCase();
  const keywords = command.keywords.toLowerCase();

  let score = 0;

  for (const term of terms) {
    let best: number;

    if (slug === term) {
      best = 100;
    } else if (slug.startsWith(term)) {
      best = 70;
    } else if (label.startsWith(term)) {
      best = 55;
    } else if (startsAtWordBoundary(slug, term) || startsAtWordBoundary(label, term)) {
      best = 40;
    } else if (slug.includes(term) || label.includes(term)) {
      best = 22;
    } else if (group.includes(term) || keywords.includes(term)) {
      best = 8;
    } else {
      return NO_MATCH;
    }

    score += best;
  }

  // Whole-query prefix bonus: typing "unp" should decisively favor "unpublish"
  // over a command that merely contains the letters.
  if (slug.startsWith(query)) {
    score += 50;
  } else if (label.startsWith(query)) {
    score += 30;
  }

  return score;
}

/** True when `term` appears in `text` at the start or just after a space/hyphen. */
function startsAtWordBoundary(text: string, term: string): boolean {
  let index = text.indexOf(term);

  while (index >= 0) {
    const prev = text[index - 1];
    if (index === 0 || prev === " " || prev === "-") {
      return true;
    }
    index = text.indexOf(term, index + 1);
  }

  return false;
}
