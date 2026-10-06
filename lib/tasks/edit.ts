/**
 * Plans the smallest text edits that apply a task change to its source line:
 * one marker character for a status, one directive inserted, replaced or removed
 * for a date. Never a whole-line rewrite, so a collaborator typing elsewhere on
 * the same line keeps their edit when the change merges through Yjs.
 *
 * Pure and framework-free: the server applies the edits to a Y.Text, and tests
 * apply them to a string. See docs/24_TASKS_AND_AGENDA_PLAN.md §5.
 */

import remarkParse from "remark-parse";
import { unified } from "unified";

import { isValidDayKey } from "@/lib/tasks/dates";
import {
  TASK_MARKER_BY_STATUS,
  TASK_MARKER_PATTERN,
  TASK_REMARK_PLUGINS,
  TASK_TIME_PATTERN,
  type TaskStatus,
} from "@/lib/tasks/parse";

export type TaskChange =
  | { type: "status"; status: TaskStatus }
  | { type: "due"; day: string | null; time?: string | null };

/** Offsets are relative to the start of whatever text the edit is applied to. */
export type TextEdit = { from: number; to: number; insert: string };

type MdastNode = {
  type: string;
  name?: string;
  children?: MdastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

type LineField = { name: "due" | "done"; from: number; to: number };

/** Blockquote markers and indentation ahead of a list marker. */
const linePrefixPattern = /^(?:[ \t]*>[ \t]?)*[ \t]*/;

type TaskLine = {
  /** Offset of the status character inside `[ ]`. */
  markerOffset: number;
  marker: string;
  fields: LineField[];
};

/**
 * Reads a task line's marker and `:due`/`:done` directive ranges. The line is
 * parsed without its quote/indent prefix: alone, four spaces of nesting would
 * turn a subtask into an indented code block. Null when it is not a task line.
 */
export function readTaskLine(lineText: string): TaskLine | null {
  const prefix = linePrefixPattern.exec(lineText)?.[0] ?? "";
  const body = lineText.slice(prefix.length);
  const marker = TASK_MARKER_PATTERN.exec(body);

  if (!marker) return null;

  const tree = unified()
    .use(remarkParse)
    .use(TASK_REMARK_PLUGINS)
    .parse(body) as unknown as MdastNode;
  const fields: LineField[] = [];

  const visit = (node: MdastNode) => {
    if (node.type === "textDirective" && (node.name === "due" || node.name === "done")) {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;

      if (from !== undefined && to !== undefined && from >= marker[0].length) {
        fields.push({ name: node.name, from: prefix.length + from, to: prefix.length + to });
      }
      return;
    }

    for (const child of node.children ?? []) visit(child);
  };

  visit(tree);

  return {
    markerOffset: prefix.length + marker[0].indexOf("[") + 1,
    marker: marker[1],
    fields: fields.sort((a, b) => a.from - b.from),
  };
}

/** Removes a directive together with one space before it, if there is one. */
function removal(lineText: string, field: LineField): TextEdit {
  const from = field.from > 0 && /[ \t]/.test(lineText[field.from - 1]) ? field.from - 1 : field.from;
  return { from, to: field.to, insert: "" };
}

/** Appends ` text` after the line's last non-space character. */
function append(lineText: string, text: string): TextEdit {
  const at = lineText.trimEnd().length;
  return { from: at, to: at, insert: ` ${text}` };
}

/**
 * The edits turning `lineText` into the changed task line, ordered from the
 * end of the line backwards so each can be applied without shifting the rest.
 * Null when `lineText` is not a task line or the change is invalid.
 *
 * Status: done stamps `:done[today]` (kept if already present); any other
 * status removes `:done[…]`. With `stampDone: false` a status change touches
 * only the marker — for a plain checkbox click by someone not using Tasks. Due: replaces the first `:due[…]` (removing any
 * duplicates), appends one when absent, or removes them all for `day: null`.
 */
export function planTaskEdit(
  lineText: string,
  change: TaskChange,
  today: string,
  options: { stampDone?: boolean } = {},
): TextEdit[] | null {
  const { stampDone = true } = options;
  const task = readTaskLine(lineText);

  if (!task || !isValidDayKey(today)) return null;

  const edits: TextEdit[] = [];
  const doneFields = task.fields.filter((field) => field.name === "done");
  const dueFields = task.fields.filter((field) => field.name === "due");

  if (change.type === "status") {
    const nextMarker = TASK_MARKER_BY_STATUS[change.status];

    // `X` and `x` both mean done; leave the author's case alone.
    if (!(change.status === "done" && /[xX]/.test(task.marker)) && task.marker !== nextMarker) {
      edits.push({ from: task.markerOffset, to: task.markerOffset + 1, insert: nextMarker });
    }

    if (!stampDone) {
      // Marker only.
    } else if (change.status === "done") {
      if (doneFields.length === 0) edits.push(append(lineText, `:done[${today}]`));
    } else {
      for (const field of doneFields) edits.push(removal(lineText, field));
    }
  } else if (change.day === null) {
    for (const field of dueFields) edits.push(removal(lineText, field));
  } else {
    if (!isValidDayKey(change.day)) return null;
    if (change.time && !TASK_TIME_PATTERN.test(change.time)) return null;

    const directive = `:due[${change.day}${change.time ? ` ${change.time}` : ""}]`;
    const [first, ...duplicates] = dueFields;

    if (first) {
      edits.push({ from: first.from, to: first.to, insert: directive });
      for (const field of duplicates) edits.push(removal(lineText, field));
    } else {
      edits.push(append(lineText, directive));
    }
  }

  return edits.sort((a, b) => b.from - a.from);
}

export function applyTextEdits(text: string, edits: TextEdit[]): string {
  let next = text;

  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
  }

  return next;
}

/**
 * Finds a task's line in the current text: the recorded line if it still reads
 * exactly `rawLine`, else the only line that does. Null when the line is gone or
 * ambiguous — the caller refuses rather than editing the wrong task.
 */
export function locateTaskLine(
  text: string,
  line: number,
  rawLine: string,
): { lineIndex: number; offset: number } | null {
  const lines = text.split("\n");
  const offsetOf = (index: number) =>
    lines.slice(0, index).reduce((sum, current) => sum + current.length + 1, 0);
  const matches = (index: number) => lines[index]?.replace(/\r$/, "") === rawLine;

  if (matches(line)) {
    return { lineIndex: line, offset: offsetOf(line) };
  }

  const found = lines.flatMap((_, index) => (matches(index) ? [index] : []));

  return found.length === 1 ? { lineIndex: found[0], offset: offsetOf(found[0]) } : null;
}
