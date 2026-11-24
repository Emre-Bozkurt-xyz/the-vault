/**
 * A document with `view: board` in its frontmatter, read as a board: each
 * `## heading` is a column and each top-level task line under it (`- [ ]`,
 * `- [/]`, `- [x]`, `- [-]`) is a card. A card's indented lines are its notes
 * and subtasks; `:priority[…]` and `:due[…]` on its line are its fields.
 *
 * The Markdown stays the source of truth. Every operation here takes the text
 * and returns new text with only the lines it means to change rewritten, so
 * collaboration, history, search and the AI tools see an ordinary edit.
 * Lines the board doesn't show (a paragraph under a heading, the intro before
 * the first column) are kept where they are.
 */

export type CardStatus = "open" | "in_progress" | "done" | "cancelled";

export type BoardSubtask = { done: boolean; text: string };

export type BoardCard = {
  /** 0-based index of the card's task line. */
  line: number;
  /** One past its last line (the task line plus its indented lines). */
  end: number;
  status: CardStatus;
  /** The task text without its fields. */
  title: string;
  priority: string | null;
  due: string | null;
  notes: string[];
  subtasks: BoardSubtask[];
};

export type BoardColumn = {
  /** 0-based index of the `## heading` line. */
  line: number;
  heading: string;
  cards: BoardCard[];
  /** Lines in the column the board doesn't show (paragraphs, other lists). */
  otherLines: number;
};

export type Board = {
  columns: BoardColumn[];
  /** 0-based index of the first line after the frontmatter. */
  bodyStart: number;
};

const MARK_TO_STATUS: Record<string, CardStatus> = { " ": "open", "/": "in_progress", x: "done", X: "done", "-": "cancelled" };
const STATUS_TO_MARK: Record<CardStatus, string> = { open: " ", in_progress: "/", done: "x", cancelled: "-" };
const cardLinePattern = /^[-*+] \[([ xX/-])\] ?(.*)$/;
const subtaskPattern = /^\s+[-*+] \[([ xX/-])\] ?(.*)$/;
const columnPattern = /^## +(.*?)\s*#*\s*$/;
const fieldPattern = (key: string) => new RegExp(`\\s*:${key}\\[([^\\]]*)\\]`);

function lines(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}

function frontmatterEnd(all: string[]): number {
  if (all[0] !== "---") return 0;
  const close = all.indexOf("---", 1);
  return close > 0 ? close + 1 : 0;
}

/** Whether frontmatter asks for the board (`view: board`). */
export function isBoardDocument(markdown: string): boolean {
  const all = lines(markdown);
  const end = frontmatterEnd(all);
  return all.slice(1, Math.max(1, end - 1)).some((line) => /^view\s*:\s*["']?board["']?\s*$/i.test(line));
}

export function cardField(text: string, key: string): string | null {
  return text.match(fieldPattern(key))?.[1]?.trim() || null;
}

/** The card's title: its text with fields and inline directives' noise removed. */
function cardTitle(text: string): string {
  return text.replace(/\s*:(priority|due|repeat|done)\[[^\]]*\]/g, "").trim();
}

export function parseBoard(markdown: string): Board {
  const all = lines(markdown);
  const bodyStart = frontmatterEnd(all);
  const columns: BoardColumn[] = [];
  let column: BoardColumn | null = null;
  let inFence = false;

  for (let index = bodyStart; index < all.length; index += 1) {
    const line = all[index];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      if (column) column.otherLines += 1;
      continue;
    }
    const heading = line.match(columnPattern);
    if (heading) {
      column = { line: index, heading: heading[1], cards: [], otherLines: 0 };
      columns.push(column);
      continue;
    }
    if (!column) continue;
    const card = line.match(cardLinePattern);
    if (!card) {
      if (line.trim() && !/^#{1,6}\s/.test(line)) column.otherLines += 1;
      continue;
    }
    let end = index + 1;
    while (end < all.length && /^\s+\S/.test(all[end])) end += 1;
    const notes: string[] = [];
    const subtasks: BoardSubtask[] = [];
    for (const child of all.slice(index + 1, end)) {
      const subtask = child.match(subtaskPattern);
      if (subtask) subtasks.push({ done: MARK_TO_STATUS[subtask[1]] === "done", text: subtask[2].trim() });
      else notes.push(child.trim());
    }
    column.cards.push({
      line: index,
      end,
      status: MARK_TO_STATUS[card[1]] ?? "open",
      title: cardTitle(card[2]),
      priority: cardField(card[2], "priority"),
      due: cardField(card[2], "due"),
      notes,
      subtasks,
    });
    index = end - 1;
  }

  return { columns, bodyStart };
}

/** Sets, replaces or (with null) removes a `:key[value]` field on a task line. */
export function setLineField(line: string, key: string, value: string | null): string {
  const pattern = fieldPattern(key);
  if (pattern.test(line)) return line.replace(pattern, value === null ? "" : ` :${key}[${value}]`);
  return value === null ? line : `${line.replace(/\s+$/, "")} :${key}[${value}]`;
}

function withLines(markdown: string, change: (all: string[]) => void): string {
  const all = lines(markdown);
  change(all);
  return all.join("\n");
}

function cardAt(markdown: string, line: number): BoardCard | null {
  for (const column of parseBoard(markdown).columns) {
    const card = column.cards.find((candidate) => candidate.line === line);
    if (card) return card;
  }
  return null;
}

export function setCardStatus(markdown: string, line: number, status: CardStatus): string {
  return withLines(markdown, (all) => {
    all[line] = all[line].replace(/^([-*+] )\[[ xX/-]\]/, `$1[${STATUS_TO_MARK[status]}]`);
  });
}

export function setCardField(markdown: string, line: number, key: "priority" | "due", value: string | null): string {
  return withLines(markdown, (all) => {
    all[line] = setLineField(all[line], key, value);
  });
}

/** Rewrites a card's title, keeping its fields. */
export function setCardTitle(markdown: string, line: number, title: string): string {
  return withLines(markdown, (all) => {
    const match = all[line].match(/^([-*+] \[[ xX/-]\] ?)(.*)$/);
    if (!match) return;
    const fields = match[2].match(/\s*:(priority|due|repeat|done)\[[^\]]*\]/g)?.join("") ?? "";
    all[line] = `${match[1]}${title.trim()}${fields}`;
  });
}

/** Replaces a card's indented lines with `notes` and `subtasks`. */
export function setCardDetails(markdown: string, line: number, notes: string[], subtasks: BoardSubtask[]): string {
  const card = cardAt(markdown, line);
  if (!card) return markdown;
  return withLines(markdown, (all) => {
    const children = [
      ...notes.filter((note) => note.trim()).map((note) => `  ${note.trim()}`),
      ...subtasks.map((subtask) => `  - [${subtask.done ? "x" : " "}] ${subtask.text.trim()}`),
    ];
    all.splice(card.line + 1, card.end - card.line - 1, ...children);
  });
}

export function deleteCard(markdown: string, line: number): string {
  const card = cardAt(markdown, line);
  if (!card) return markdown;
  return withLines(markdown, (all) => {
    all.splice(card.line, card.end - card.line);
  });
}

/** Where a new card goes in a column: after its last card, else right under the heading. */
function insertionLine(all: string[], column: BoardColumn): number {
  const last = column.cards[column.cards.length - 1];
  return last ? last.end : column.line + 1;
}

export function addCard(markdown: string, columnLine: number, title: string): string {
  const column = parseBoard(markdown).columns.find((candidate) => candidate.line === columnLine);
  if (!column || !title.trim()) return markdown;
  return withLines(markdown, (all) => {
    all.splice(insertionLine(all, column), 0, `- [ ] ${title.trim()}`);
  });
}

/** Adds `## name` at the end of the document. */
export function addColumn(markdown: string, name: string): string {
  if (!name.trim()) return markdown;
  const trimmed = markdown.replace(/\s+$/, "");
  return `${trimmed}${trimmed ? "\n\n" : ""}## ${name.trim()}\n`;
}

export function renameColumn(markdown: string, columnLine: number, name: string): string {
  if (!name.trim()) return markdown;
  return withLines(markdown, (all) => {
    if (columnPattern.test(all[columnLine])) all[columnLine] = `## ${name.trim()}`;
  });
}

/**
 * Moves a card (its whole block) into `toColumnLine` at position `toIndex`
 * among that column's cards (as they are before the move).
 */
export function moveCard(markdown: string, line: number, toColumnLine: number, toIndex: number): string {
  const board = parseBoard(markdown);
  const card = board.columns.flatMap((column) => column.cards).find((candidate) => candidate.line === line);
  const target = board.columns.find((column) => column.line === toColumnLine);
  if (!card || !target) return markdown;

  const others = target.cards.filter((candidate) => candidate.line !== line);
  const clamped = Math.max(0, Math.min(toIndex, others.length));
  // Insert before the card now at `clamped`, else after the column's last card / heading.
  const before = others[clamped];
  const after = others[others.length - 1];
  const anchor = before ? before.line : after ? after.end : target.line + 1;
  // Inserting right before or right after itself: already there.
  if (anchor === card.line || anchor === card.end) return markdown;

  return withLines(markdown, (all) => {
    const block = all.slice(card.line, card.end);
    const insertAt = anchor > card.line ? anchor - block.length : anchor;
    all.splice(card.line, block.length);
    all.splice(insertAt, 0, ...block);
  });
}

/** The smallest single replacement turning `before` into `after`, for an editor transaction. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
