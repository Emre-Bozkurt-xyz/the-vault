"use client";

/**
 * The client half of the workspace's one task write path (plan §5.5). Every
 * surface — sidebar agenda, Tasks page, home Today, document panel, `:::tasks`
 * blocks — calls `runTaskWrite`, so they all behave the same:
 *
 * - **Optimistic everywhere.** The change shows at once as a shared patch
 *   (`useTaskPatches`), in every open list, not just the one clicked.
 * - **One queue.** Writes run one at a time across the tab, so two surfaces
 *   never race on a document. A field change records the line it will leave
 *   behind, so a second change queued for the same task still finds it.
 * - **One voice.** Deletes and moves confirm with Undo; bulk changes say what
 *   they did; failures say why. Then every list refetches.
 */

import { useSyncExternalStore } from "react";

import { formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import { expectedRawLine, type RowChange, type TaskPatch } from "@/lib/tasks/optimistic";
import { plainTaskText } from "@/lib/tasks/query";
import { dispatchTasksChanged, showWorkspaceToast } from "@/lib/workspace-toast";
import { runTaskOperationAction, undoTaskOperationAction, type TaskOperationActionResult } from "@/server/tasks";

export type { RowChange } from "@/lib/tasks/optimistic";

/** Where a task is and what its line said when the user acted on it. */
export type TaskTarget = { documentId: string; line: number; rawLine: string; text?: string };

/** How long a landed write's patch outlives it, covering the refetch and overlay. */
const settleMs = 1500;
/** How long a predicted line stays usable by writes queued behind it. */
const aliasMs = 30_000;
const maxLabelLength = 60;

let patches: readonly TaskPatch[] = [];
let nextPatchId = 1;
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
/** `documentId + line text` → the line a landed write turned it into. */
const aliases = new Map<string, { rawLine: string; expires: number }>();

const aliasKey = (documentId: string, rawLine: string) => `${documentId}\u0000${rawLine}`;

function setPatches(next: readonly TaskPatch[]) {
  patches = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getPatches = () => patches;
const noPatches: readonly TaskPatch[] = [];

/** Pending optimistic changes; pass them to `applyTaskPatches`. */
export function useTaskPatches(): readonly TaskPatch[] {
  return useSyncExternalStore(subscribe, getPatches, () => noPatches);
}

function currentLine(target: TaskTarget): string {
  let rawLine = target.rawLine;
  for (let hops = 0; hops < 20; hops += 1) {
    const alias = aliases.get(aliasKey(target.documentId, rawLine));
    if (!alias || alias.expires < Date.now()) break;
    rawLine = alias.rawLine;
  }
  return rawLine;
}

function label(text: string | undefined): string {
  const plain = plainTaskText(text ?? "") || "task";
  return plain.length > maxLabelLength ? `${plain.slice(0, maxLabelLength - 1)}…` : plain;
}

function describe(change: RowChange, tasks: TaskTarget[], targetTitle: string | null, today: string): string | null {
  const count = tasks.length;
  const subject = count === 1 ? `“${label(tasks[0].text)}”` : `${count} tasks`;

  switch (change.type) {
    case "delete":
      return `Deleted ${subject}`;
    case "move":
      return `Moved ${subject} to ${targetTitle ?? change.targetTitle}`;
    case "status":
      if (count === 1) return null;
      return change.status === "done"
        ? `Completed ${count} tasks`
        : change.status === "cancelled"
          ? `Cancelled ${count} tasks`
          : `Updated ${count} tasks`;
    case "due":
      if (count === 1) return null;
      return change.day ? `Moved ${count} tasks to ${formatDueLabel(change.day, today)}` : `Cleared the date on ${count} tasks`;
    default:
      return count === 1 ? null : `Updated ${count} tasks`;
  }
}

/**
 * Applies `change` to `tasks` (one or many, across documents). Resolves to
 * whether the server accepted it; failures are already announced.
 */
export function runTaskWrite(tasks: TaskTarget[], change: RowChange): Promise<boolean> {
  if (tasks.length === 0) return Promise.resolve(false);
  const today = todayDayKey();
  const added = tasks.map((task) => ({
    id: nextPatchId++,
    documentId: task.documentId,
    rawLine: task.rawLine,
    change,
  }));
  const ids = new Set(added.map((patch) => patch.id));
  const dropPatches = () => setPatches(patches.filter((patch) => !ids.has(patch.id)));
  setPatches([...patches, ...added]);

  const run = queue.then(async () => {
    const items = tasks.map((task) => ({ documentId: task.documentId, line: task.line, rawLine: currentLine(task) }));
    const operation =
      change.type === "delete"
        ? { kind: "delete" as const }
        : change.type === "move"
          ? { kind: "move" as const, targetDocumentId: change.targetDocumentId }
          : { kind: "change" as const, change };

    const result: TaskOperationActionResult = await runTaskOperationAction({ today, items, operation }).catch(
      () => ({ ok: false as const, error: "Could not change the task." }),
    );
    const documentIds = new Set(tasks.map((task) => task.documentId));
    if (change.type === "move") documentIds.add(change.targetDocumentId);
    const changed = { documentId: documentIds.size === 1 ? [...documentIds][0] : null };

    if (!result.ok) {
      dropPatches();
      dispatchTasksChanged(changed);
      showWorkspaceToast({ message: result.error, tone: "error" });
      return false;
    }

    for (const item of items) {
      const next = expectedRawLine(item.rawLine, change, today);
      if (next && next !== item.rawLine) {
        aliases.set(aliasKey(item.documentId, item.rawLine), { rawLine: next, expires: Date.now() + aliasMs });
      }
    }
    setTimeout(dropPatches, settleMs);
    dispatchTasksChanged(changed);

    const message = describe(change, tasks, result.targetTitle, today);
    const skipped = result.skipped
      ? `${result.skipped === 1 ? "One task" : `${result.skipped} tasks`} had changed and ${result.skipped === 1 ? "was" : "were"} left alone.`
      : null;
    const undo = result.undo;

    if (message || skipped) {
      showWorkspaceToast({
        message: [message, skipped].filter(Boolean).join(" · "),
        action: undo
          ? {
              label: "Undo",
              run: async () => {
                const undone = await undoTaskOperationAction(undo).catch(() => ({
                  ok: false as const,
                  error: "Could not undo.",
                }));
                dispatchTasksChanged(changed);
                if (!undone.ok) showWorkspaceToast({ message: undone.error, tone: "error" });
              },
            }
          : undefined,
      });
    }
    return true;
  });

  queue = run.catch(() => undefined);
  return run;
}
