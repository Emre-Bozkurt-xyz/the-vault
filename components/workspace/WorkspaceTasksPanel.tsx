"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, ListChecks, RefreshCw } from "lucide-react";

import { TaskCaptureInput } from "@/components/tasks/TaskCaptureInput";
import { TaskRow } from "@/components/tasks/TaskRow";
import { taskMoveTargets } from "@/components/tasks/TaskActionsMenu";
import { useLiveDocumentTasks } from "@/components/tasks/use-live-tasks";
import {
  SidePanel,
  SidePanelAction,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  SidePanelSection,
  SidePanelToolbar,
} from "@/components/workspace/SidePanel";
import { useVisibleRefresh } from "@/components/workspace/panel-visibility";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { addDaysToDayKey, formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import { applyTaskPatches } from "@/lib/tasks/optimistic";
import { inAgenda, liveRow, mergeLiveTasks } from "@/lib/tasks/overlay";
import { loadTaskAgenda } from "@/lib/tasks/shared-agenda";
import { runTaskWrite, useTaskPatches } from "@/lib/tasks/task-writes";
import { priorityRank, taskKey } from "@/lib/tasks/views";
import { subscribeToTasksChanged } from "@/lib/workspace-toast";
import type { TaskAgendaResult } from "@/server/tasks";
import type { AgendaTask } from "@/server/tasks-data";

/**
 * The sidebar agenda (docs/24_TASKS_AND_AGENDA_PLAN.md §6.1): open tasks from
 * the viewer's own documents, bucketed against the viewer's local day.
 *
 * Rows are the server's agenda, with any document open in an editor replaced
 * by its live parse (§5.4) and pending writes applied on top (§5.3), then
 * filtered by the same rules the server query uses. Writes go through the
 * shared queue in `lib/tasks/task-writes.ts`.
 */

/**
 * After an editor save, the collaboration server writes the document text on a
 * debounce (1.5s, at most 10s); refetching before then would read the old text.
 */
const refetchAfterSaveMs = 2500;

type Section = { id: string; label: string; tasks: AgendaTask[]; overdue?: boolean };

function compareTasks(a: AgendaTask, b: AgendaTask) {
  // Undated (Inbox) tasks sort last.
  const dayOrder =
    a.dueDay === b.dueDay ? 0 : a.dueDay === null ? 1 : b.dueDay === null ? -1 : a.dueDay.localeCompare(b.dueDay);

  return (
    dayOrder ||
    (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.documentTitle.localeCompare(b.documentTitle) ||
    a.ordinal - b.ordinal
  );
}

export function WorkspaceTasksPanel() {
  const [result, setResult] = useState<TaskAgendaResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const live = useLiveDocumentTasks();
  const patches = useTaskPatches();

  // Only ever sets state after the request resolves, so calling it from an
  // effect never renders synchronously inside that effect.
  const load = useCallback(async () => {
    let next: TaskAgendaResult;
    try {
      next = await loadTaskAgenda(todayDayKey());
    } catch {
      next = { ok: false, error: "Could not load tasks." };
    }
    setResult(next);
    setRefreshing(false);
  }, []);

  // While the panel is collapsed these only mark the agenda stale; it reloads
  // once, when the panel is shown again.
  const requestLoad = useVisibleRefresh(useCallback(() => void load(), [load]));

  useEffect(() => {
    requestLoad();

    // A day can roll over while the panel sits open; refocusing the window is
    // a cheap moment to catch up.
    const onFocus = () => requestLoad();
    window.addEventListener("focus", onFocus);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToWorkspaceDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(requestLoad, refetchAfterSaveMs);
    });
    // Writes, captures and live server notices; the index is already fresh.
    const unsubscribeTasks = subscribeToTasksChanged(() => requestLoad());

    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      unsubscribeTasks();
      if (timer) clearTimeout(timer);
    };
  }, [requestLoad]);

  const agenda = result?.ok ? result : null;

  const tasks = useMemo<AgendaTask[]>(() => {
    if (!agenda) return [];
    const context = { today: agenda.today, through: agenda.through, inboxDocumentId: agenda.inboxDocumentId };
    const merged = mergeLiveTasks(agenda.tasks, live, {
      ownedOnly: true,
      include: (task, document) => inAgenda(task, { ...context, documentId: document.documentId }),
      build: (task, document) => liveRow(task, document),
    });
    return applyTaskPatches(merged, patches, agenda.today)
      .filter((task) => inAgenda(task, { ...context, documentId: task.documentId }))
      .sort(compareTasks);
  }, [agenda, live, patches]);

  const sections = useMemo<Section[]>(() => {
    if (!agenda) return [];

    const overdue: AgendaTask[] = [];
    const today: AgendaTask[] = [];
    const upcoming: AgendaTask[] = [];
    const inbox: AgendaTask[] = [];

    for (const task of tasks) {
      if (task.dueDay === null) {
        inbox.push(task);
      } else if (task.status === "done") {
        // A task finished today counts as today's work, whenever it was due.
        (task.dueDay > agenda.today ? upcoming : today).push(task);
      } else if (task.dueDay < agenda.today) overdue.push(task);
      else if (task.dueDay === agenda.today) today.push(task);
      else upcoming.push(task);
    }

    return [
      { id: "overdue", label: "Overdue", tasks: overdue, overdue: true },
      { id: "today", label: "Today", tasks: today },
      { id: "upcoming", label: "Next 7 days", tasks: upcoming },
      { id: "inbox", label: "Inbox", tasks: inbox },
    ];
  }, [agenda, tasks]);

  const moveTargets = useMemo(
    () => taskMoveTargets(tasks, agenda?.inboxDocumentId ?? null),
    [tasks, agenda?.inboxDocumentId],
  );

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  const openCount = agenda ? tasks.filter((task) => task.status !== "done").length : null;

  return (
    <SidePanel>
      <SidePanelHeader
        icon={ListChecks}
        title="Tasks"
        subtitle={openCount === null ? "Agenda" : `${openCount} open this week`}
        actions={
          <>
            <SidePanelAction
              icon={RefreshCw}
              label="Refresh tasks"
              onClick={refresh}
              disabled={refreshing}
              spinning={refreshing}
            />
            <SidePanelAction icon={ArrowUpRight} label="Open Tasks page" href="/tasks" />
          </>
        }
      />

      <SidePanelToolbar>
        <TaskCaptureInput />
      </SidePanelToolbar>

      <SidePanelBody>
        {result === null ? (
          <SidePanelEmpty>Loading tasks…</SidePanelEmpty>
        ) : !result.ok ? (
          <SidePanelEmpty>{result.error}</SidePanelEmpty>
        ) : tasks.length === 0 && result.events.length === 0 ? (
          <EmptyAgenda today={result.today} laterCount={result.laterCount} />
        ) : (
          <>
            {sections.map((section) =>
              section.tasks.length > 0 ? (
                <SidePanelSection
                  key={section.id}
                  title={section.label}
                  count={section.tasks.filter((task) => task.status !== "done").length}
                  tone={section.overdue ? "danger" : "default"}
                  collapsible
                  action={
                    section.overdue ? (
                      <button
                        type="button"
                        title="Move every overdue task to today"
                        onClick={() =>
                          void runTaskWrite(
                            section.tasks.filter((task) => task.status !== "done"),
                            { type: "due", day: result.today },
                          )
                        }
                        className="rounded px-1.5 py-0.5 text-[0.7rem] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        Move to today
                      </button>
                    ) : undefined
                  }
                >
                  {section.tasks.map((task) => {
                    const key = taskKey(task);
                    return (
                      <TaskRow
                        key={key}
                        task={task}
                        today={result.today}
                        variant="sidebar"
                        showDue={section.id !== "today" && section.id !== "inbox"}
                        editing={editingKey === key}
                        onEditingChange={(editing) => setEditingKey(editing ? key : null)}
                        moveTargets={moveTargets}
                      />
                    );
                  })}
                </SidePanelSection>
              ) : null,
            )}
            {result.events.length > 0 ? (
              <SidePanelSection title="Calendar events" count={result.events.length} collapsible>
                <div className="grid gap-0.5">
                  {result.events.map((event) => (
                    <Link key={event.id} href={`/docs/${event.documentId}`}
                      className="flex items-start gap-2 rounded-[5px] px-2 py-1.5 text-sm hover:bg-sidebar-accent">
                      <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{event.text || "Untitled event"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{event.documentTitle} · {formatDueLabel(event.day, result.today)}{event.time ? ` ${event.time}` : ""}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </SidePanelSection>
            ) : null}
            {result.laterCount > 0 ? (
              <SidePanelEmpty>
                {result.laterCount} more due later.{" "}
                <Link href="/tasks" className="underline underline-offset-2 hover:text-foreground">
                  See all tasks
                </Link>
              </SidePanelEmpty>
            ) : null}
          </>
        )}
      </SidePanelBody>
    </SidePanel>
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
