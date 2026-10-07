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
