"use client";

import { useEffect, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";

import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { todayDayKey } from "@/lib/calendar";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { formatDueLabel } from "@/lib/tasks/dates";
import { plainTaskText } from "@/lib/tasks/query";
import { cn } from "@/lib/utils";
import { dispatchTasksChanged, subscribeToTasksChanged } from "@/lib/workspace-toast";
import { getDocumentTasksAction, updateTaskAction } from "@/server/tasks";
import type { DocumentTaskSummary } from "@/server/tasks-data";

/** After an editor save the collab server stores the text on a debounce. */
const refetchAfterSaveMs = 2500;
const maxListed = 12;

/**
 * "Tasks in this document" in the document's right context panel (plan §6.4):
 * a count, the next due date, and the open tasks with their subtask progress.
 * Click a task to jump to its line; tick it to complete it in place.
 */
export function DocumentTasksSection({ documentId }: { documentId: string }) {
  const [tasks, setTasks] = useState<DocumentTaskSummary[] | null>(null);
  const [today] = useState(todayDayKey);

  useEffect(() => {
    let cancelled = false;
    // State is only set in the promise callback, never synchronously here.
    const load = () => {
      void getDocumentTasksAction({ documentId }).then(
        (next) => {
          if (!cancelled) setTasks(next);
        },
        () => {
          if (!cancelled) setTasks(null);
        },
      );
    };

    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeDocuments = subscribeToWorkspaceDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, refetchAfterSaveMs);
    });
    const unsubscribeTasks = subscribeToTasksChanged(load);
    return () => {
      cancelled = true;
      unsubscribeDocuments();
      unsubscribeTasks();
      if (timer) clearTimeout(timer);
    };
  }, [documentId]);

  const summary = useMemo(() => {
    const all = tasks ?? [];
    const open = all.filter((task) => task.status === "open" || task.status === "in_progress");
    const nextDue = open
      .map((task) => task.dueDay)
      .filter((day): day is string => day !== null)
      .sort()[0];
    const children = new Map<number, { done: number; total: number }>();

    for (const task of all) {
      if (task.parentOrdinal === null || task.status === "cancelled") continue;
      const entry = children.get(task.parentOrdinal) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (task.status === "done") entry.done += 1;
      children.set(task.parentOrdinal, entry);
    }

    const listed = [...open].sort(
      (a, b) =>
        (a.dueDay ?? "9999").localeCompare(b.dueDay ?? "9999") || a.ordinal - b.ordinal,
    );

    return { total: all.length, open: open.length, nextDue, children, listed };
  }, [tasks]);

  const toggle = async (task: DocumentTaskSummary) => {
    setTasks((current) =>
      current?.map((candidate) =>
        candidate.ordinal === task.ordinal ? { ...candidate, status: "done" } : candidate,
      ) ?? current,
    );
    await updateTaskAction({
      today: todayDayKey(),
      documentId,
      line: task.line,
      rawLine: task.rawLine,
      change: { type: "status", status: "done" },
    }).catch(() => null);
    dispatchTasksChanged();
  };

  if (tasks === null) {
    return null;
  }

  return (
    <section className="border-b border-border/70 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">Tasks</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.total === 0
              ? "No tasks in this document."
              : `${summary.open} open${
                  summary.nextDue ? ` · next due ${formatDueLabel(summary.nextDue, today)}` : ""
                }`}
          </p>
        </div>
        <ListChecks className="size-4 shrink-0 text-muted-foreground" />
      </div>

      {summary.listed.length > 0 ? (
        <ul className="mt-2 grid gap-0.5">
          {summary.listed.slice(0, maxListed).map((task) => {
            const progress = summary.children.get(task.ordinal);
            const overdue = task.dueDay !== null && task.dueDay < today;
            return (
              <li key={task.ordinal} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-muted/50">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={false}
                  aria-label="Mark done"
                  onClick={() => void toggle(task)}
                  className="vault-task-box mt-[0.15rem] cursor-pointer"
                  data-status={task.status}
                  data-overdue={overdue ? "true" : undefined}
                />
                <button
                  type="button"
                  onClick={() =>
                    requestEditorJump({ documentId, line: task.line, text: task.rawLine })
                  }
                  className="min-w-0 flex-1 text-left text-xs leading-5"
                >
                  <span className="block truncate">{plainTaskText(task.text) || "Untitled task"}</span>
                  {task.dueDay || progress ? (
                    <span className={cn("block text-[0.7rem] text-muted-foreground", overdue && "text-destructive")}>
                      {task.dueDay ? formatDueLabel(task.dueDay, today) : ""}
                      {task.dueDay && progress ? " · " : ""}
                      {progress ? `${progress.done}/${progress.total} subtasks` : ""}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {summary.listed.length > maxListed ? (
        <p className="mt-1 px-1 text-xs text-muted-foreground">
          {summary.listed.length - maxListed} more
        </p>
      ) : null}
    </section>
  );
}
