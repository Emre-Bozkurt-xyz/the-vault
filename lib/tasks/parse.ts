/**
 * Finds the tasks in a Markdown document: list items whose marker is followed by
 * `[ ]`, `[/]`, `[x]` or `[-]`, with optional `:due[…]` / `:done[…]` fields.
 *
 * This is the one parser every task surface trusts (index, agenda, agent
 * actions), so it leans on the real Markdown structure rather than line regexes:
 * a checkbox inside a fenced code block is not a task, a checklist inside a
 * callout is, and `:due[…]` is recognised only as a directive node, never as
 * text inside inline code. See `docs/24_TASKS_AND_AGENDA_PLAN.md` §3.
 *
 * Two things come from the raw source instead of the tree:
 *
 * - The status marker. GFM only understands `[ ]` and `[x]`; `[/]` and `[-]`
 *   parse as ordinary paragraph text, so the marker is read from the item's
 *   source line at the item's own column.
 * - Directive values. A directive's `[…]` content is parsed as inline Markdown
 *   (the calc module's raw-source invariant), so values are sliced from source
 *   via `node.position` and the parsed children are ignored.
 */

import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { isValidDayKey } from "@/lib/tasks/dates";

export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.some((priority) => priority === value);
}

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export type ParsedTask = {
  /** Nth task in the document, 0-based, in source order. */
  ordinal: number;
  /** 0-based source line of the task's marker. */
  line: number;
  /** The exact source line, the precondition for writing back to it. */
  rawLine: string;
  /** Ordinal of the enclosing task, for subtasks. */
  parentOrdinal: number | null;
  status: TaskStatus;
  /** First line of the task, Markdown, with task directives removed. */
  text: string;
  /** Continuation text under the task (not subtasks), or null. */
  note: string | null;
  /** Nearest preceding heading's plain text, or null. */
  heading: string | null;
  /** `YYYY-MM-DD`, or null when undated or the value is invalid. */
  dueDay: string | null;
  /** `HH:MM`, only alongside a valid `dueDay`. */
  dueTime: string | null;
  /** True when a `:due[…]` was written but its value is not a real date. */
  dueInvalid: boolean;
  doneDay: string | null;
  priority: TaskPriority | null;
};

/** Per-document ceiling; later tasks are skipped rather than failing the index. */
export const MAX_TASKS_PER_DOCUMENT = 2000;
/** Matches the Calendar entry text limit. */
export const MAX_TASK_TEXT_LENGTH = 500;
const MAX_TASK_NOTE_LENGTH = 2000;

export const TASK_DIRECTIVE_NAMES = ["due", "done", "priority"] as const;

/** A list marker plus task box at the start of a string; group 1 is the box character. */
export const TASK_MARKER_PATTERN = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX/-])\](?=[ \t]|$)/;
const markerPattern = TASK_MARKER_PATTERN;
export const TASK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timePattern = TASK_TIME_PATTERN;

/** The Markdown plugins task parsing uses, shared so every caller sees the same tree. */
export const TASK_REMARK_PLUGINS = [remarkGfm, remarkMath, remarkDirective];

const statusByMarker: Record<string, TaskStatus> = {
  " ": "open",
  "/": "in_progress",
  x: "done",
  X: "done",
  "-": "cancelled",
};

export const TASK_MARKER_BY_STATUS: Record<TaskStatus, string> = {
  open: " ",
  in_progress: "/",
  done: "x",
  cancelled: "-",
};

export function taskStatusFromMarker(marker: string): TaskStatus | null {
  return statusByMarker[marker] ?? null;
}

type Point = { line?: number; column?: number; offset?: number };

type MdastNode = {
  type: string;
  name?: string;
  value?: string;
  depth?: number;
  children?: MdastNode[];
  position?: { start?: Point; end?: Point };
};

/**
 * Blanks a leading YAML frontmatter block (same rule as the editor: first line
 * `---`, closed by the next `---` line) with spaces, keeping every offset and
 * line number intact. Without this remark reads it as a thematic break plus a
 * setext heading, and a `- [ ]` inside YAML would become a task.
 */
function maskFrontmatter(lines: string[]): string[] {
  if (lines.length < 2 || lines[0]?.trim() !== "---") {
    return lines;
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (end === -1) {
    return lines;
  }

  return lines.map((line, index) => (index <= end ? " ".repeat(line.length) : line));
}

function plainText(node: MdastNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }

  return (node.children ?? []).map(plainText).join("");
}

/** Reads a directive's `[…]` value from source; null when it has none. */
function directiveValue(source: string, node: MdastNode): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (start === undefined || end === undefined) {
    return null;
  }

  const match = /^:[A-Za-z][\w-]*\[([^\]\n]*)\]/.exec(source.slice(start, end));
  return match ? match[1].trim() : null;
}

function parseDue(value: string | null): {
  dueDay: string | null;
  dueTime: string | null;
} | null {
  if (!value) return null;

  const [day, time, ...rest] = value.split(/\s+/);

  if (!day || rest.length > 0 || !isValidDayKey(day)) return null;
  if (time !== undefined && !timePattern.test(time)) return null;

  return { dueDay: day, dueTime: time ?? null };
}

/** Strips one `>`-quote level and indentation from each continuation line. */
function cleanNoteLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:>\s?)*/, "").trimEnd())
    .join("\n")
    .trim();
}

export function parseTasks(markdown: string): ParsedTask[] {
  const originalLines = markdown.split(/\r?\n/);
  const lines = maskFrontmatter(originalLines);
  // Parse the masked text so frontmatter never becomes structure, but slice
  // raw lines from the original so a write-back precondition matches exactly.
  const source = lines.join("\n");
  const tree = unified()
    .use(remarkParse)
    .use(TASK_REMARK_PLUGINS)
    .parse(source) as unknown as MdastNode;

  const lineOffsets: number[] = [];
  let runningOffset = 0;

  for (const line of lines) {
    lineOffsets.push(runningOffset);
    runningOffset += line.length + 1;
  }

  const tasks: ParsedTask[] = [];
  let currentHeading: string | null = null;

  const visit = (node: MdastNode, parentOrdinal: number | null): void => {
    if (tasks.length >= MAX_TASKS_PER_DOCUMENT) return;

    if (node.type === "heading") {
      currentHeading = plainText(node).trim() || null;
      return;
    }

    let ownOrdinal = parentOrdinal;

    if (node.type === "listItem") {
      const task = readTask(node, parentOrdinal);

      if (task) {
        tasks.push(task);
        ownOrdinal = task.ordinal;
      }
    }

    for (const child of node.children ?? []) {
      visit(child, ownOrdinal);
    }
  };

  const readTask = (
    item: MdastNode,
    parentOrdinal: number | null,
  ): ParsedTask | null => {
    const lineNumber = item.position?.start?.line;
    const column = item.position?.start?.column;

    if (!lineNumber || !column) return null;

    const lineIndex = lineNumber - 1;
    const sourceLine = lines[lineIndex] ?? "";
    const fromMarker = sourceLine.slice(column - 1);
    const marker = markerPattern.exec(fromMarker);

    if (!marker) return null;

    const status = taskStatusFromMarker(marker[1]);
    if (!status) return null;

    // Directives on the task's own first line, found structurally so one inside
    // inline code (a text node, not a directive) is never read as a field.
    const lineStartOffset = lineOffsets[lineIndex] ?? 0;
    const lineEndOffset = lineStartOffset + sourceLine.length;
    const fieldRanges: Array<[number, number]> = [];
    let due: { dueDay: string | null; dueTime: string | null } | null = null;
    let dueInvalid = false;
    let doneDay: string | null = null;
    let priority: TaskPriority | null = null;

    const paragraph = (item.children ?? []).find(
      (child) => child.type === "paragraph",
    );

    const collect = (node: MdastNode) => {
      if (
        node.type === "textDirective" &&
        (node.name === "due" || node.name === "done" || node.name === "priority")
      ) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;

        if (
          start !== undefined &&
          end !== undefined &&
          start >= lineStartOffset &&
          end <= lineEndOffset
        ) {
          const value = directiveValue(source, node);

          if (node.name === "due") {
            const parsed = parseDue(value);
            if (parsed && !due) {
              due = parsed;
            } else if (!parsed) {
              dueInvalid = true;
            }
          } else if (node.name === "priority") {
            if (!isTaskPriority(value)) return; // Keep invalid values visible in task text.
            priority ??= value;
          } else if (value && isValidDayKey(value) && !doneDay) {
            doneDay = value;
          }

          fieldRanges.push([start - lineStartOffset, end - lineStartOffset]);
          return;
        }
      }

      for (const child of node.children ?? []) collect(child);
    };

    if (paragraph) collect(paragraph);

    const textStart = column - 1 + marker[0].length;
    let text = "";
    let cursor = textStart;

    for (const [start, end] of fieldRanges.sort((a, b) => a[0] - b[0])) {
      if (start < cursor) continue;
      text += sourceLine.slice(cursor, start);
      cursor = end;
    }

    text += sourceLine.slice(cursor);
    text = text.replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_TASK_TEXT_LENGTH);

    const noteParts: string[] = [];

    for (const child of item.children ?? []) {
      if (child.type === "list") continue;

      const start = child.position?.start?.offset;
      const end = child.position?.end?.offset;
      if (start === undefined || end === undefined) continue;

      const from = Math.max(start, lineEndOffset + 1);
      if (from < end) noteParts.push(source.slice(from, end));
    }

    const note = cleanNoteLines(noteParts.join("\n\n")).slice(0, MAX_TASK_NOTE_LENGTH);
    const resolvedDue = due as { dueDay: string | null; dueTime: string | null } | null;

    return {
      ordinal: tasks.length,
      line: lineIndex,
      rawLine: originalLines[lineIndex] ?? sourceLine,
      parentOrdinal,
      status,
      text,
      note: note || null,
      heading: currentHeading,
      dueDay: resolvedDue?.dueDay ?? null,
      dueTime: resolvedDue?.dueTime ?? null,
      dueInvalid: dueInvalid && !resolvedDue,
      doneDay,
      priority,
    };
  };

  visit(tree, null);
  return tasks;
}
