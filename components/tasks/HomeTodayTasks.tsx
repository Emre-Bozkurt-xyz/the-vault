"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { todayDayKey } from "@/lib/tasks/dates";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { formatDueLabel } from "@/lib/tasks/dates";
import { plainTaskText } from "@/lib/tasks/query";
import { taskKey } from "@/lib/tasks/views";
import { cn } from "@/lib/utils";
import { dispatchTasksChanged, subscribeToTasksChanged } from "@/lib/workspace-toast";
import { getTaskAgendaAction, updateTaskAction, type TaskAgendaResult } from "@/server/tasks";
import type { AgendaTask } from "@/server/tasks-data";

/**
 * The home page's "Today" section (plan §6.4): what is overdue and due today,
 * tickable in place, above the recent documents. Renders nothing when there is
 * nothing to show, so the new-tab page stays quiet on a clear day.
 */
export function HomeTodayTasks() {
  const [result, setResult] = useState<TaskAgendaResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // State is only set in the promise callback, never synchronously here.
    const load = () => {
      void getTaskAgendaAction({ today: todayDayKey() }).then(
        (next) => {
          if (!cancelled) setResult(next);
        },
        () => {
          if (!cancelled) setResult({ ok: false, error: "" });
        },
      );
    };

    load();
    const unsubscribe = subscribeToTasksChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const tasks = useMemo(() => {
    if (!result?.ok) return [];
    // Overdue and due today, plus anything ticked off today that was due by now.
    return result.tasks.filter((task) => task.dueDay !== null && task.dueDay <= result.today);
  }, [result]);

  const toggle = async (task: AgendaTask) => {
    const done = task.status === "done";
    setResult((current) =>
      current?.ok
        ? {
            ...current,
            tasks: current.tasks.map((candidate) =>
              taskKey(candidate) === taskKey(task)
                ? { ...candidate, status: done ? "open" : "done", doneDay: done ? null : current.today }
                : candidate,
            ),
          }
        : current,
    );
    await updateTaskAction({
      today: todayDayKey(),
      documentId: task.documentId,
      line: task.line,
      rawLine: task.rawLine,
      change: { type: "status", status: done ? "open" : "done" },
    }).catch(() => null);
    dispatchTasksChanged();
  };

  if (!result?.ok || tasks.length === 0) {
    return null;
  }

  const open = tasks.filter((task) => task.status !== "done").length;

  return (
    <div className="mt-9 sm:mt-12">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs sm:tracking-[0.18em]">
          Today
        </h2>
        <Link
          href="/tasks"
          className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          {open} open <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <ul className="mt-4 grid gap-0.5 sm:mt-5 sm:gap-1">
        {tasks.map((task) => {
          const done = task.status === "done";
          const overdue = !done && task.dueDay !== null && task.dueDay < result.today;
          return (
            <li key={taskKey(task)} className="flex min-w-0 items-center gap-3 py-1.5 sm:py-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={done ? "Mark not done" : "Mark done"}
                onClick={() => void toggle(task)}
                className="vault-task-box cursor-pointer"
                data-status={task.status}
                data-overdue={overdue ? "true" : undefined}
              />
              <Link
                href={`/docs/${task.documentId}`}
                onClick={() =>
                  requestEditorJump({ documentId: task.documentId, line: task.line, text: task.rawLine })
                }
                className={cn(
                  "min-w-0 flex-1 truncate text-sm transition hover:text-foreground sm:text-lg",
                  done ? "text-muted-foreground line-through" : "text-foreground/90",
                )}
              >
                {plainTaskText(task.text) || "Untitled task"}
              </Link>
              <span className={cn("shrink-0 text-xs text-muted-foreground", overdue && "text-destructive")}>
                {task.documentTitle}
                {overdue && task.dueDay ? ` · ${formatDueLabel(task.dueDay, result.today)}` : ""}
                {task.dueTime ? ` · ${task.dueTime}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
