/**
 * Pure write-back helpers for Markdown task lines
 * (`docs/24_TASKS_AND_AGENDA_PLAN.md` §5). Each returns the new text of one line
 * (or an insertion plan); the caller applies it to the live Y.Text as a minimal
 * edit, so a collaborator typing elsewhere on the same line keeps their text.
 *
 * Line indexes here are 0-based, like `ParsedTask.line`.
 */

import { slugify } from "@/lib/slug";
import { isValidDayKey } from "@/lib/tasks/dates";
import type { TaskStatus } from "@/lib/tasks/parse";

const markerByStatus: Record<TaskStatus, string> = {
  open: " ",
  in_progress: "/",
  done: "x",
  cancelled: "-",
};

/** Leading quote/indent, list marker, `[`, the status character, `]`. */
const taskMarkerPattern = /^([ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX/-])(\])/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export class TaskMovedError extends Error {
  constructor() {
    super(
      "That task has moved or changed since it was listed. List the tasks again and retry with the new line and rawLine.",
    );
    this.name = "TaskMovedError";
  }
}

/**
 * Finds a task's current line (§5.1): the indexed line if it still reads
 * `rawLine`, otherwise the one line anywhere that does. Two or more identical
 * lines elsewhere, or none, is refused rather than guessed.
 */
export function locateTaskLine(
  lines: readonly string[],
  line: number,
  rawLine: string,
): number {
  if (lines[line] === rawLine) {
    return line;
  }

  let found = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== rawLine) continue;
    if (found !== -1) throw new TaskMovedError();
    found = index;
  }

  if (found === -1) {
    throw new TaskMovedError();
  }

  return found;
}

/** Character ranges of inline code spans, where a `:due[…]` is just text. */
function codeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (const match of line.matchAll(/(`+)[^`]*?\1/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }

  return ranges;
}

/** The `:name[…]` directive on a line, outside inline code, or null. */
function findDirective(
  line: string,
  name: "due" | "done",
): { start: number; end: number } | null {
  const code = codeSpanRanges(line);
  const pattern = new RegExp(`(?<![\\w:]):${name}\\[[^\\]\\n]*\\]`, "g");

  for (const match of line.matchAll(pattern)) {
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    return { start, end: start + match[0].length };
  }

  return null;
}

/** Removes a directive and the single space before it, if any. */
function removeDirective(line: string, name: "due" | "done"): string {
  const found = findDirective(line, name);
  if (!found) return line;

  const start = found.start > 0 && line[found.start - 1] === " " ? found.start - 1 : found.start;
  return line.slice(0, start) + line.slice(found.end);
}

/**
 * Inserts ` :name[value]` before `before` (another directive's start) or at
 * the end of the line's content, keeping trailing whitespace where it was.
 */
function insertDirective(line: string, directive: string, beforeIndex?: number): string {
  if (beforeIndex !== undefined) {
    return `${line.slice(0, beforeIndex)}${directive} ${line.slice(beforeIndex)}`;
  }

  const content = line.replace(/\s+$/, "");
  return `${content} ${directive}${line.slice(content.length)}`;
}

function setDirective(
  line: string,
  name: "due" | "done",
  value: string,
  beforeName?: "done",
): string {
  const directive = `:${name}[${value}]`;
  const existing = findDirective(line, name);

  if (existing) {
    return line.slice(0, existing.start) + directive + line.slice(existing.end);
  }

  const before = beforeName ? findDirective(line, beforeName) : null;
  return insertDirective(line, directive, before?.start);
}

/**
 * Sets a task line's status marker. Completing stamps `:done[today]` (an
 * existing done date is kept, so repeating the call changes nothing); any
 * other status clears it.
 */
export function setTaskLineStatus(
  line: string,
  status: TaskStatus,
  today: string,
): string {
  const marker = taskMarkerPattern.exec(line);

  if (!marker) {
    throw new Error("That line is not a task.");
  }

  if (!isValidDayKey(today)) {
    throw new Error("today must be a real YYYY-MM-DD date.");
  }

  const nextMarker = markerByStatus[status];
  const currentlyDone = marker[2] === "x" || marker[2] === "X";
  let next =
    status === "done" && currentlyDone
      ? line
      : line.slice(0, marker[1].length) + nextMarker + line.slice(marker[1].length + 1);

  if (status === "done") {
    if (!findDirective(next, "done")) {
      next = setDirective(next, "done", today);
    }
  } else {
    next = removeDirective(next, "done");
  }

  return next;
}

export type TaskDue = { day: string; time?: string | null };

function formatDue(due: TaskDue): string {
  if (!isValidDayKey(due.day)) {
    throw new Error("Due day must be a real YYYY-MM-DD date.");
  }

  if (due.time && !timePattern.test(due.time)) {
    throw new Error("Due time must be HH:MM (24-hour).");
  }

  return due.time ? `${due.day} ${due.time}` : due.day;
}

/** Sets, replaces, or (with null) clears a task line's `:due[…]`. */
export function setTaskLineDue(line: string, due: TaskDue | null): string {
  if (!taskMarkerPattern.test(line)) {
    throw new Error("That line is not a task.");
  }

  if (due === null) {
    return removeDirective(line, "due");
  }

  // A new due date goes before `:done[…]`, the order the editor writes them.
  return setDirective(line, "due", formatDue(due), "done");
}

/**
 * A new open task line: `- [ ] text :due[…]`. The text must be one line; a
 * leading checkbox the caller already wrote is not doubled.
 */
export function formatTaskLine(text: string, due?: TaskDue | null): string {
  const body = text
    .trim()
    .replace(/^(?:[-*+]|\d{1,9}[.)])\s+\[[ xX/-]\]\s*/, "")
    .trim();

  if (!body) {
    throw new Error("Task text is required.");
  }

  if (/[\r\n]/.test(body)) {
    throw new Error("Task text must be a single line.");
  }

  return due ? `- [ ] ${body} :due[${formatDue(due)}]` : `- [ ] ${body}`;
}

const listItemPattern = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const headingPattern = /^(#{1,6})\s+(.+?)\s*#*$/;

export type TaskInsertion = {
  /** Character offset to insert at. */
  offset: number;
  /** Text to insert, including any separating newlines. */
  text: string;
  /** 0-based line the new task will occupy. */
  line: number;
};

/**
 * Where a new task line goes: the end of the document, or the end of the
 * section under `heading` (matched by text or slug, fence-aware, the same rule
 * as `insert_at_heading`). It joins a list that already ends the region — no
 * blank line, so the list stays tight — and otherwise starts a new block after
 * a blank line. Nothing is needed after it: the region's last non-blank line is
 * followed only by blank lines, a heading (which interrupts a list), or the end
 * of the document. Returns null when the heading does not exist.
 */
export function planTaskInsertion(
  markdown: string,
  taskLine: string,
  heading?: string,
): TaskInsertion | null {
  const lines = markdown.split("\n");
  let regionEnd = lines.length;

  if (heading) {
    const wanted = heading.trim().toLowerCase();
    const wantedSlug = slugify(heading);
    let inFence = false;
    let start = -1;
    let level = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;

      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        continue;
      }

      if (inFence) continue;

      const match = headingPattern.exec(line);
      if (!match) continue;

      if (start === -1) {
        const text = match[2]!.trim();
        if (text.toLowerCase() === wanted || slugify(text) === wantedSlug) {
          start = index;
          level = match[1]!.length;
        }
      } else if (match[1]!.length <= level) {
        regionEnd = index;
        break;
      }
    }

    if (start === -1) {
      return null;
    }
  }

  // Last non-blank line inside the region.
  let last = regionEnd - 1;
  while (last >= 0 && lines[last]!.trim() === "") last -= 1;

  const offsetOfLineEnd = (index: number) =>
    lines.slice(0, index + 1).reduce((sum, line) => sum + line.length + 1, 0) - 1;

  if (last < 0) {
    // Empty document (or empty region at the very top): the task is the first line.
    return { offset: 0, text: markdown.length > 0 ? `${taskLine}\n` : taskLine, line: 0 };
  }

  const joinsList = listItemPattern.test(lines[last]!);

  return {
    offset: offsetOfLineEnd(last),
    text: `${joinsList ? "\n" : "\n\n"}${taskLine}`,
    line: last + (joinsList ? 1 : 2),
  };
}

/**
 * The smallest single replacement turning `before` into `after` (common prefix
 * and suffix trimmed), relative to the start of the line.
 */
export function minimalReplacement(
  before: string,
  after: string,
): { from: number; deleteCount: number; insert: string } {
  let start = 0;
  const limit = Math.min(before.length, after.length);

  while (start < limit && before[start] === after[start]) start += 1;

  let endBefore = before.length;
  let endAfter = after.length;

  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return {
    from: start,
    deleteCount: endBefore - start,
    insert: after.slice(start, endAfter),
  };
}
