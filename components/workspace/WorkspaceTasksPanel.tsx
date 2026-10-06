"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Inbox,
  ListChecks,
  Plus,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { TaskActionsMenu } from "@/components/tasks/TaskActionsMenu";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { captureTaskFromClient } from "@/lib/tasks/capture-client";
import { addDaysToDayKey, formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import type { TaskChange } from "@/lib/tasks/edit";
import { cn } from "@/lib/utils";
import { subscribeToTasksChanged } from "@/lib/workspace-toast";
import {
  getTaskAgendaAction,
  updateTaskAction,
  type TaskAgendaResult,
} from "@/server/tasks";
import type { AgendaTask } from "@/server/tasks-data";

/**
 * The sidebar agenda (docs/24_TASKS_AND_AGENDA_PLAN.md §6.1): open tasks from
 * the viewer's own documents, bucketed against the viewer's local day. Ticking
 * and rescheduling write back into the source document (slice 2); clicking a
 * task's text opens the document at its line.
 *
 * Changes are optimistic. Writes to one document run one at a time, and each
 * looks up its task's *current* line and text when it runs (tasks are keyed by
 * document + ordinal, which a status or date edit never changes), so a second
 * click on a row still finds the line the first click rewrote.
 */

/**
 * After an editor save, the collaboration server writes the document text on a
 * debounce (1.5s, at most 10s); refetching before then would read the old text.
 */
const refetchAfterSaveMs = 2500;

type OkAgenda = Extract<TaskAgendaResult, { ok: true }>;
type Section = { id: string; label: string; tasks: AgendaTask[]; overdue?: boolean };

function taskKey(task: Pick<AgendaTask, "documentId" | "ordinal">) {
  return `${task.documentId}:${task.ordinal}`;
}

function compareTasks(a: AgendaTask, b: AgendaTask) {
  // Undated (Inbox) tasks sort last.
  const dayOrder =
    a.dueDay === b.dueDay ? 0 : a.dueDay === null ? 1 : b.dueDay === null ? -1 : a.dueDay.localeCompare(b.dueDay);

  return (
    dayOrder ||
    (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
    a.documentTitle.localeCompare(b.documentTitle) ||
    a.ordinal - b.ordinal
  );
}

/** What the server will return after `change`, applied locally ahead of it. */
function applyLocally(agenda: OkAgenda, key: string, change: TaskChange): OkAgenda {
  let laterCount = agenda.laterCount;
  const tasks = agenda.tasks.flatMap((task) => {
    if (taskKey(task) !== key) return [task];

    if (change.type === "status") {
      // Cancelled tasks leave the agenda; done ones stay struck through today.
      if (change.status === "cancelled") return [];
      return [
        {
          ...task,
          status: change.status,
          doneDay: change.status === "done" ? (task.doneDay ?? agenda.today) : null,
        },
      ];
    }

    // An undated Inbox task still belongs in the Inbox section.
    if (change.day === null) {
      return task.documentId === agenda.inboxDocumentId
        ? [{ ...task, dueDay: null, dueTime: null }]
        : [];
    }
    if (change.day > agenda.through) {
      laterCount += 1;
      return [];
    }
    return [{ ...task, dueDay: change.day, dueTime: change.time ?? null }];
  });

  return { ...agenda, tasks: tasks.sort(compareTasks), laterCount };
}

export function WorkspaceTasksPanel() {
  const [result, setResult] = useState<TaskAgendaResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  /** Latest agenda the server returned, for looking up a task's current line. */
  const serverAgendaRef = useRef<OkAgenda | null>(null);
  /** Writes in flight; while any are, server responses must not overwrite optimistic rows. */
  const pendingWritesRef = useRef(0);
  const documentQueuesRef = useRef(new Map<string, Promise<void>>());

  const acceptServerResult = useCallback((next: TaskAgendaResult) => {
    if (next.ok) serverAgendaRef.current = next;
    if (pendingWritesRef.current === 0) setResult(next);
  }, []);

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
      acceptServerResult(next);
      setRefreshing(false);
    }
  }, [acceptServerResult]);

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
    // A capture or undo from anywhere (the palette included) already wrote
    // through the index, so this refetch needs no delay.
    const unsubscribeTasks = subscribeToTasksChanged(() => void load());

    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      unsubscribeTasks();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const changeTask = useCallback(
    (task: AgendaTask, change: TaskChange) => {
      const key = taskKey(task);

      setNotice(null);
      setResult((current) => (current?.ok ? applyLocally(current, key, change) : current));
      pendingWritesRef.current += 1;

      const queues = documentQueuesRef.current;
      const previous = queues.get(task.documentId) ?? Promise.resolve();
      const run = previous.then(async () => {
        const latest =
          serverAgendaRef.current?.tasks.find((candidate) => taskKey(candidate) === key) ?? task;
        let next: TaskAgendaResult;

        try {
          next = await updateTaskAction({
            today: todayDayKey(),
            documentId: latest.documentId,
            line: latest.line,
            rawLine: latest.rawLine,
            change,
          });
        } catch {
          next = { ok: false, error: "Could not change the task." };
        }

        pendingWritesRef.current -= 1;

        if (next.ok) {
          acceptServerResult(next);
        } else {
          // Drop optimistic state and show what the documents really say.
          setNotice(next.error);
          if (pendingWritesRef.current === 0) void load();
        }
      });

      queues.set(task.documentId, run);
      void run.finally(() => {
        if (queues.get(task.documentId) === run) queues.delete(task.documentId);
      });
    },
    [acceptServerResult, load],
  );

  const sections = useMemo<Section[]>(() => {
    if (!result?.ok) return [];

    const overdue: AgendaTask[] = [];
    const today: AgendaTask[] = [];
    const upcoming: AgendaTask[] = [];
    const inbox: AgendaTask[] = [];

    for (const task of result.tasks) {
      if (task.dueDay === null) {
        inbox.push(task);
      } else if (task.status === "done") {
        // A task finished today counts as today's work, whenever it was due.
        (task.dueDay > result.today ? upcoming : today).push(task);
      } else if (task.dueDay < result.today) overdue.push(task);
      else if (task.dueDay === result.today) today.push(task);
      else upcoming.push(task);
    }

    return [
      { id: "overdue", label: "Overdue", tasks: overdue, overdue: true },
      { id: "today", label: "Today", tasks: today },
      { id: "upcoming", label: "Next 7 days", tasks: upcoming },
      { id: "inbox", label: "Inbox", tasks: inbox },
    ];
  }, [result]);

  const refresh = () => {
    setRefreshing(true);
    setNotice(null);
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

      <CaptureBox />

      {notice ? (
        <p role="status" className="border-b border-border/70 px-3 py-1.5 text-xs text-destructive">
          {notice}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {result === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading tasks…</p>
        ) : !result.ok ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{result.error}</p>
        ) : result.tasks.length === 0 && result.events.length === 0 ? (
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
                    <span className="font-normal tabular-nums">
                      {section.tasks.filter((task) => task.status !== "done").length}
                    </span>
                  </h3>
                  <div className="grid gap-0.5">
                    {section.tasks.map((task) => (
                      <TaskRow
                        key={taskKey(task)}
                        task={task}
                        today={result.today}
                        showDue={section.id !== "today" && section.id !== "inbox"}
                        overdue={Boolean(section.overdue)}
                        onChange={(change) => changeTask(task, change)}
                      />
                    ))}
                  </div>
                </section>
              ) : null,
            )}
            {result.events.length > 0 ? (
              <section className="mb-3" aria-label="Calendar events">
                <h3 className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Calendar events</h3>
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
              </section>
            ) : null}
            {result.laterCount > 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {result.laterCount} more due later.
              </p>
            ) : null}
            <Link
              href="/tasks"
              className="mt-1 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              Open Tasks page <ArrowUpRight className="size-3" />
            </Link>
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
  onChange,
}: {
  task: AgendaTask;
  today: string;
  showDue: boolean;
  overdue: boolean;
  onChange: (change: TaskChange) => void;
}) {
  const done = task.status === "done";
  const context = task.heading ? `${task.documentTitle} › ${task.heading}` : task.documentTitle;

  return (
    // No "active document" highlight: tasks cluster in a few documents, so
    // marking every row of the open one would light up most of the list.
    <div className="group relative grid grid-cols-[0.95rem_minmax(0,1fr)_1.5rem] items-start gap-x-2 rounded-[5px] px-2 py-1.5 text-sm transition hover:bg-sidebar-accent">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark not done" : "Mark done"}
        title={done ? "Mark not done" : "Mark done"}
        onClick={() => onChange({ type: "status", status: done ? "open" : "done" })}
        className="vault-task-box mt-[0.2rem] cursor-pointer"
        data-status={task.status}
        data-overdue={overdue && !done ? "true" : undefined}
      />

      <Link
        href={`/docs/${task.documentId}`}
        onClick={() =>
          requestEditorJump({ documentId: task.documentId, line: task.line, text: task.rawLine })
        }
        className="min-w-0 group-hover:text-sidebar-accent-foreground"
      >
        <span
          className={cn(
            "vault-task-md block",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {task.text ? (
            <MarkdownDocument markdown={task.text} contained={false} disableLinks />
          ) : (
            <span className="italic text-muted-foreground">Untitled task</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{context}</span>
          {(showDue && task.dueDay) || task.dueTime ? (
            <span
              className={cn(
                "ml-auto shrink-0 tabular-nums",
                overdue && !done ? "text-destructive" : null,
              )}
            >
              {showDue && task.dueDay ? formatDueLabel(task.dueDay, today) : ""}
              {task.dueTime ? `${showDue ? " " : ""}${task.dueTime}` : ""}
            </span>
          ) : null}
        </span>
      </Link>

      <TaskActionsMenu
        task={task}
        today={today}
        onChange={onChange}
        className="opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </div>
  );
}

/**
 * Quick capture into the Inbox: "send invoice friday" becomes
 * `- [ ] send invoice :due[<friday>]`. The confirmation (with Undo) is a
 * workspace toast, shared with `/task` in the command palette.
 */
function CaptureBox() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    const result = await captureTaskFromClient(text);
    setSaving(false);
    if (result.ok) setText("");
  };

  return (
    <form
      className="border-b border-border/70 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex h-8 items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2 focus-within:border-foreground/40">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add task…"
          title="Add to your Inbox. A date at the end is picked up: “call Sam friday”."
          aria-label="Add a task to your Inbox"
          disabled={saving}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <Inbox className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </label>
    </form>
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
