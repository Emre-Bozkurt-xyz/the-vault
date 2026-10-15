import { addDaysToDayKey, daysBetween } from "@/lib/tasks/dates";
import {
  applyTextEdits,
  locateTaskLine,
  planTaskEdit,
  type TaskChange,
  type TextEdit,
} from "@/lib/tasks/edit";
import { parseTasks } from "@/lib/tasks/parse";
import { anchorRecurrence, nextRecurringDay } from "@/lib/tasks/recurrence";

/** A whole task item cut from its document, with what Undo needs to put it back. */
export type TaskRemoval = {
  edit: TextEdit;
  /** 0-based line the item started on. */
  lineIndex: number;
  /** The item's lines (task, note, subtasks), without a trailing newline. */
  block: string;
};

/**
 * Plans deleting a task: the task line plus everything its list item owns —
 * continuation notes and nested subtasks — the way deleting a bullet in an
 * outliner takes its children. Null when the task moved (see `locateTaskLine`).
 */
export function planTaskRemoval(markdown: string, line: number, rawLine: string): TaskRemoval | null {
  const located = locateTaskLine(markdown, line, rawLine);
  if (!located) return null;
  const task = parseTasks(markdown).find((candidate) => candidate.line === located.lineIndex);
  if (!task) return null;

  const lines = markdown.split("\n");
  const endLine = Math.min(Math.max(task.endLine, task.line), lines.length - 1);
  const block = lines.slice(task.line, endLine + 1).join("\n");
  const from = located.offset;
  const to = from + block.length;

  // Take the line break after the block; at the very end of the text, take
  // the one before it instead, so no blank line is left behind.
  const edit =
    to < markdown.length
      ? { from, to: to + 1, insert: "" }
      : { from: Math.max(0, from - 1), to, insert: "" };

  return { edit, lineIndex: task.line, block };
}

/**
 * Undo for `planTaskRemoval`: reinserts `block` at the start of line
 * `lineIndex`, or at the end when the document has since grown shorter. Line
 * based rather than offset based, so edits elsewhere in the meantime do not
 * shift where it lands by more than they moved that line.
 */
export function planTaskRestore(markdown: string, lineIndex: number, block: string): TextEdit {
  const lines = markdown.split("\n");

  if (lineIndex < lines.length) {
    const offset = lines.slice(0, lineIndex).reduce((sum, current) => sum + current.length + 1, 0);
    return { from: offset, to: offset, insert: `${block}\n` };
  }

  const separator = markdown.length > 0 && !markdown.endsWith("\n") ? "\n" : "";
  return { from: markdown.length, to: markdown.length, insert: `${separator}${block}\n` };
}

/** Blockquote markers and indentation ahead of a task's list marker. */
const blockPrefixPattern = /^(?:[ \t]*>[ \t]?)*[ \t]*/;

/**
 * A removed task block made top-level for another document: the first line's
 * quote/indent prefix comes off every line that carries it, so a subtask or a
 * task inside a callout lands as an ordinary list item, children still nested.
 */
export function dedentTaskBlock(block: string): string {
  const lines = block.split("\n");
  const prefix = blockPrefixPattern.exec(lines[0] ?? "")?.[0] ?? "";
  if (!prefix) return block;

  return lines
    .map((line) => {
      if (line.startsWith(prefix)) return line.slice(prefix.length);
      // A shallower line (a lazy continuation): drop what prefix it has.
      return line.replace(blockPrefixPattern, "");
    })
    .join("\n");
}

/** Appends a block at the end of a document; `lineIndex` is where it starts. */
export function planBlockAppend(markdown: string, block: string): { edit: TextEdit; lineIndex: number } {
  const separator = markdown.length > 0 && !markdown.endsWith("\n") ? "\n" : "";
  const lineIndex = markdown.length === 0 ? 0 : markdown.split("\n").length - (separator ? 0 : 1);
  return { edit: { from: markdown.length, to: markdown.length, insert: `${separator}${block}\n` }, lineIndex };
}

/**
 * Undo for `planBlockAppend`: removes `block` if it still starts at
 * `lineIndex`, else its only exact occurrence at a line start. Null when it
 * was edited or appears more than once — Undo then leaves it alone.
 */
export function planBlockRemoval(markdown: string, lineIndex: number, block: string): TextEdit | null {
  const lines = markdown.split("\n");
  const offsetOf = (index: number) => lines.slice(0, index).reduce((sum, current) => sum + current.length + 1, 0);
  const blockLines = block.split("\n");
  const startsAt = (index: number) =>
    blockLines.every((line, offset) => lines[index + offset]?.replace(/\r$/, "") === line.replace(/\r$/, ""));

  let start = startsAt(lineIndex) ? lineIndex : -1;
  if (start === -1) {
    const found = lines.flatMap((_, index) => (startsAt(index) ? [index] : []));
    if (found.length !== 1) return null;
    start = found[0];
  }

  const from = offsetOf(start);
  const to = from + lines.slice(start, start + blockLines.length).join("\n").length;
  return to < markdown.length
    ? { from, to: to + 1, insert: "" }
    : { from: Math.max(0, from - 1), to, insert: "" };
}

/** One shared planner for Live, Read, agenda, and agents. Offsets are document-wide. */
export function planTaskDocumentEdit(
  markdown: string,
  line: number,
  rawLine: string,
  change: TaskChange,
  today: string,
  options: { stampDone?: boolean } = {},
): TextEdit[] | null {
  const located = locateTaskLine(markdown, line, rawLine);
  if (!located) return null;
  const edits = planTaskEdit(rawLine, change, today, options);
  if (!edits) return null;
  const absolute = edits.map((edit) => ({
    ...edit,
    from: located.offset + edit.from,
    to: located.offset + edit.to,
  }));
  if (
    options.stampDone === false ||
    change.type !== "status" ||
    change.status !== "done"
  )
    return absolute;
  const tasks = parseTasks(markdown);
  const task = tasks.find((candidate) => candidate.line === located.lineIndex);
  if (!task?.repeat || task.status === "done" || task.status === "cancelled")
    return absolute;
  // The outer recurring checklist owns its cadence. Children reset when it repeats,
  // rather than independently accumulating occurrence history inside the template.
  let parent = task.parentOrdinal;
  while (parent !== null) {
    const ancestor = tasks[parent];
    if (!ancestor) break;
    if (ancestor.repeat) return absolute;
    parent = ancestor.parentOrdinal;
  }
  const repeat = anchorRecurrence(task.repeat, task.dueDay ?? today);
  const next = nextRecurringDay(repeat, task.dueDay, today);
  if (!next) return null;
  const lines = markdown.split("\n");
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const blockLines = lines.slice(task.line, task.endLine + 1);
  const cloned = [...blockLines];
  const delta = task.dueDay ? daysBetween(task.dueDay, next) : 0;
  // Archive the old occurrence's recurrence fields. Re-ticking history cannot spawn a duplicate.
  for (const item of tasks.filter(
    (candidate) =>
      candidate.line >= task.line && candidate.line <= task.endLine,
  )) {
    const index = item.line - task.line;
    let copy = item.rawLine;
    copy = applyTextEdits(
      copy,
      planTaskEdit(
        copy,
        {
          type: "status",
          status: item.status === "cancelled" ? "cancelled" : "open",
        },
        today,
      )!,
    );
    if (item.ordinal === task.ordinal)
      copy = applyTextEdits(
        copy,
        planTaskEdit(
          copy,
          { type: "due", day: next, time: task.dueTime },
          today,
        )!,
      );
    else if (item.dueDay && delta)
      copy = applyTextEdits(
        copy,
        planTaskEdit(
          copy,
          {
            type: "due",
            day: addDaysToDayKey(item.dueDay, delta),
            time: item.dueTime,
          },
          today,
        )!,
      );
    if (item.ordinal === task.ordinal && repeat !== task.repeat)
      copy = applyTextEdits(
        copy,
        planTaskEdit(copy, { type: "repeat", repeat }, today)!,
      );
    cloned[index] = copy + (blockLines[index].endsWith("\r") ? "\r" : "");
    const offset = lines
      .slice(0, item.line)
      .reduce((sum, current) => sum + current.length + 1, 0);
    if (
      item.ordinal !== task.ordinal &&
      (item.status === "open" || item.status === "in_progress")
    ) {
      absolute.push(
        ...planTaskEdit(
          item.rawLine,
          { type: "status", status: "cancelled" },
          today,
        )!.map((edit) => ({
          ...edit,
          from: offset + edit.from,
          to: offset + edit.to,
        })),
      );
    }
    if (item.repeat) {
      absolute.push(
        ...planTaskEdit(
          item.rawLine,
          { type: "repeat", repeat: null },
          today,
        )!.map((edit) => ({
          ...edit,
          from: offset + edit.from,
          to: offset + edit.to,
        })),
      );
    }
  }
  const end =
    lines
      .slice(0, task.endLine)
      .reduce((sum, current) => sum + current.length + 1, 0) +
    lines[task.endLine].replace(/\r$/, "").length;
  const insertion = newline + cloned.join("\n").replace(/\r$/, "");
  const samePoint = absolute.find(
    (edit) => edit.from === end && edit.to === end,
  );
  if (samePoint) samePoint.insert += insertion;
  else absolute.push({ from: end, to: end, insert: insertion });
  // The insertion at the last line must precede any edits on that line.
  return absolute.sort((a, b) => b.from - a.from);
}
