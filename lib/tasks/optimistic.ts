/**
 * Optimistic task edits shared by every task list (plan §5.3).
 *
 * A pending write is a patch keyed by its task's document and exact source
 * line, not by ordinal: deletes, moves and recurring completions renumber the
 * tasks below them, but a line's text identifies it until the write lands.
 * Once any source (a refetch, the live editor overlay) shows the new line, the
 * patch no longer matches anything and drops out by itself.
 */

import { applyTextEdits, normalizeTaskText, planTaskEdit, readTaskRepeat, type TaskChange } from "@/lib/tasks/edit";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/parse";

/** A field change, or deleting the task, or moving it to another document. */
export type RowChange =
  | TaskChange
  | { type: "delete" }
  | { type: "move"; targetDocumentId: string; targetTitle: string };

export type TaskPatch = { id: number; documentId: string; rawLine: string; change: RowChange };

export type PatchableRow = {
  documentId: string;
  rawLine: string;
  status: TaskStatus;
  text: string;
  dueDay: string | null;
  dueTime: string | null;
  doneDay?: string | null;
  priority: TaskPriority | null;
  repeat: string | null;
};

/** `row` after `change`, or null when the change removes it from the list. */
export function patchRow<T extends PatchableRow>(row: T, change: RowChange, today: string): T | null {
  switch (change.type) {
    case "delete":
    case "move":
      return null;
    case "status":
      return {
        ...row,
        status: change.status,
        doneDay: change.status === "done" ? (row.doneDay ?? today) : null,
      };
    case "due":
      return { ...row, dueDay: change.day, dueTime: change.day ? (change.time ?? null) : null };
    case "priority":
      return { ...row, priority: change.priority };
    case "repeat":
      return { ...row, repeat: change.repeat };
    case "text":
      return { ...row, text: normalizeTaskText(change.text) ?? row.text };
  }
}

/** Applies pending patches in the order they were made. */
export function applyTaskPatches<T extends PatchableRow>(rows: T[], patches: readonly TaskPatch[], today: string): T[] {
  if (patches.length === 0) return rows;
  return rows.flatMap((row) => {
    let current: T | null = row;
    for (const patch of patches) {
      if (!current) break;
      if (patch.documentId === row.documentId && patch.rawLine === row.rawLine) {
        current = patchRow(current, patch.change, today);
      }
    }
    return current ? [current] : [];
  });
}

/**
 * The line a field change will leave behind, so a second write queued for the
 * same task can find it. Null when it cannot be predicted from the line alone:
 * completing a recurring task also rewrites its fields and inserts the next one.
 */
export function expectedRawLine(rawLine: string, change: RowChange, today: string): string | null {
  if (change.type === "delete" || change.type === "move") return null;
  if (change.type === "status" && change.status === "done" && readTaskRepeat(rawLine)) return null;
  const edits = planTaskEdit(rawLine, change, today);
  return edits ? applyTextEdits(rawLine, edits) : null;
}
