"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ListChecks, RefreshCw } from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { addDaysToDayKey, formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import { getTaskAgendaAction, type TaskAgendaResult } from "@/server/tasks";
import type { AgendaTask } from "@/server/tasks-data";

/**
 * The sidebar agenda (docs/24_TASKS_AND_AGENDA_PLAN.md §6.1, slice 1): open
 * tasks from the viewer's own documents, bucketed against the viewer's local
 * day. Read-only for now — ticking and rescheduling land with write-back in
 * slice 2. Clicking a task opens its document at the task's line.
 */

/**
 * After an editor save, the collaboration server writes the document text on a
 * debounce (1.5s, at most 10s); refetching before then would read the old text.
 */
const refetchAfterSaveMs = 2500;

type Section = { id: string; label: string; tasks: AgendaTask[]; overdue?: boolean };

export function WorkspaceTasksPanel({ activeHref }: { activeHref: string }) {
  const [result, setResult] = useState<TaskAgendaResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestIdRef = useRef(0);

  // Only ever sets state after the request resolves, so calling it from an
  // effect never renders synchronously inside that effect.
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    let next: TaskAgendaResult;

    try {
      next = await getTaskAgendaAction({ today: todayDayKey() });
    } catch {
      next = { ok: false, error: "Could not load tasks." };
    }

    if (requestId === requestIdRef.current) {
      setResult(next);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();

    // A day can roll over, or a document change elsewhere, while the panel
    // sits open; refocusing the window is a cheap moment to catch up.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToWorkspaceDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), refetchAfterSaveMs);
    });

    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const sections = useMemo<Section[]>(() => {
    if (!result?.ok) return [];

    const overdue: AgendaTask[] = [];
    const today: AgendaTask[] = [];
    const upcoming: AgendaTask[] = [];

    for (const task of result.tasks) {
      if (task.dueDay < result.today) overdue.push(task);
      else if (task.dueDay === result.today) today.push(task);
      else upcoming.push(task);
    }

    return [
      { id: "overdue", label: "Overdue", tasks: overdue, overdue: true },
      { id: "today", label: "Today", tasks: today },
      { id: "upcoming", label: "Next 7 days", tasks: upcoming },
    ];
  }, [result]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tasks
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh tasks"
          title="Refresh"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {result === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading tasks…</p>
        ) : !result.ok ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{result.error}</p>
        ) : result.tasks.length === 0 ? (
          <EmptyAgenda today={result.today} laterCount={result.laterCount} />
        ) : (
          <>
            {sections.map((section) =>
              section.tasks.length > 0 ? (
                <section key={section.id} className="mb-3">
                  <h3
                    className={cn(
                      "flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]",
                      section.overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {section.label}
                    <span className="font-normal tabular-nums">{section.tasks.length}</span>
                  </h3>
                  <div className="grid gap-0.5">
                    {section.tasks.map((task) => (
                      <TaskRow
                        key={`${task.documentId}:${task.ordinal}`}
                        task={task}
                        today={result.today}
                        showDue={section.id !== "today"}
                        overdue={Boolean(section.overdue)}
                        active={activeHref === `/docs/${task.documentId}`}
                      />
                    ))}
                  </div>
                </section>
              ) : null,
            )}
            {result.laterCount > 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {result.laterCount} more due later.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  today,
  showDue,
  overdue,
  active,
}: {
  task: AgendaTask;
  today: string;
  showDue: boolean;
  overdue: boolean;
  active: boolean;
}) {
  const href = `/docs/${task.documentId}`;
  const context = task.heading ? `${task.documentTitle} › ${task.heading}` : task.documentTitle;

  return (
    <Link
      href={href}
      onClick={() =>
        requestEditorJump({
          documentId: task.documentId,
          line: task.line,
          text: task.rawLine,
        })
      }
      className={cn(
        "grid grid-cols-[0.95rem_minmax(0,1fr)] gap-x-2 rounded-[5px] px-2 py-1.5 text-sm transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active ? "bg-sidebar-accent/60" : null,
      )}
    >
      <span
        className="vault-task-box mt-[0.2rem]"
        data-status={task.status}
        data-overdue={overdue ? "true" : undefined}
        aria-label={task.status === "in_progress" ? "In progress" : "Open"}
        role="img"
      />
      <span className="min-w-0">
        <span className="vault-task-md block text-foreground">
          {task.text ? (
            <MarkdownDocument markdown={task.text} contained={false} disableLinks />
          ) : (
            <span className="italic text-muted-foreground">Untitled task</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{context}</span>
          {showDue ? (
            <span
              className={cn(
                "ml-auto shrink-0 tabular-nums",
                overdue ? "text-destructive" : null,
              )}
            >
              {formatDueLabel(task.dueDay, today)}
              {task.dueTime ? ` ${task.dueTime}` : ""}
            </span>
          ) : task.dueTime ? (
            <span className="ml-auto shrink-0 tabular-nums">{task.dueTime}</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function EmptyAgenda({ today, laterCount }: { today: string; laterCount: number }) {
  const example = addDaysToDayKey(today, 1);

  return (
    <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <ListChecks className="size-3.5" />
        Nothing due this week
      </p>
      {laterCount > 0 ? (
        <p className="mt-1">{laterCount} task{laterCount === 1 ? "" : "s"} due later.</p>
      ) : null}
      <p className="mt-2 flex gap-1.5">
        <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Give a task in any of your documents a date and it shows up here:{" "}
          <code className="whitespace-nowrap">- [ ] Call Sam :due[{example}]</code>
        </span>
      </p>
    </div>
  );
}
