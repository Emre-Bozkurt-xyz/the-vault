"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ListChecks,
  ListTodo,
  Search,
} from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { openWorkspaceSettings } from "@/components/settings/SettingsModalController";
import { TaskActionsMenu } from "@/components/tasks/TaskActionsMenu";
import { TaskDetailPanel, type TaskRef } from "@/components/tasks/TaskDetailPanel";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import {
  addMonths,
  formatMonthLabel,
  getMonthMatrix,
  todayDayKey,
  type CalendarMonth,
} from "@/lib/tasks/dates";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { buildFolderPaths, type FolderPathNode } from "@/lib/folder-paths";
import { addDaysToDayKey, formatDueLabel } from "@/lib/tasks/dates";
import type { TaskChange } from "@/lib/tasks/edit";
import {
  dayCounts,
  filterTasks,
  groupAgenda,
  groupBacklog,
  mondayOf,
  taskKey,
  tasksByDay,
  weekDays,
  type TaskFilters,
} from "@/lib/tasks/views";
import { cn } from "@/lib/utils";
import { dispatchTasksChanged, subscribeToTasksChanged } from "@/lib/workspace-toast";
import {
  getTaskDetailAction,
  getTaskPageAction,
  updateTaskAction,
  type TaskPageResult,
} from "@/server/tasks";
import type { PageTask, TaskDetail } from "@/server/tasks-data";

/**
 * The full Tasks page (docs/24_TASKS_AND_AGENDA_PLAN.md §6.2, slice 5): Agenda,
 * Week, Month and Backlog views over every open task in the viewer's own
 * documents, with filters, keyboard control and a detail panel on the right.
 * All grouping lives in `lib/tasks/views.ts`; this file is presentation and
 * the optimistic write queue (the same pattern as the sidebar agenda).
 */

type View = "agenda" | "week" | "month" | "backlog";
type OkPage = Extract<TaskPageResult, { ok: true }>;

const pageDescriptor = { type: "tasks", title: "Tasks", href: "/tasks" } as const;
const refetchAfterSaveMs = 2500;
const dragType = "application/x-vault-task";

const views: Array<{ id: View; label: string; icon: typeof ListTodo }> = [
  { id: "agenda", label: "Agenda", icon: ListTodo },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "month", label: "Month", icon: CalendarDays },
  { id: "backlog", label: "Backlog", icon: Inbox },
];

export function TasksPage({
  enabled,
  folders,
}: {
  enabled: boolean;
  folders: FolderPathNode[];
}) {
  return enabled ? <TasksWorkspace folders={folders} /> : <TasksDisabled />;
}

function TasksDisabled() {
  return (
    <>
      <WorkspacePageRegistration page={pageDescriptor} />
      <section className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <ListChecks className="mx-auto size-6 text-muted-foreground" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight vault-display">Tasks is off</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Turn on the Tasks extension to see an agenda of the task lines in your documents.
        </p>
        <button
          type="button"
          onClick={() => openWorkspaceSettings("extensions")}
          className="mt-4 rounded-md border border-border/70 px-3 py-1.5 text-sm transition hover:bg-muted"
        >
          Open Settings → Extensions
        </button>
      </section>
    </>
  );
}

function patchTask(task: PageTask, change: TaskChange, today: string): PageTask | null {
  if (change.type === "status") {
    if (change.status === "cancelled") return null;
    return {
      ...task,
      status: change.status,
      doneDay: change.status === "done" ? (task.doneDay ?? today) : null,
    };
  }
  return { ...task, dueDay: change.day, dueTime: change.day ? (change.time ?? null) : null };
}

function TasksWorkspace({ folders }: { folders: FolderPathNode[] }) {
  const router = useRouter();
  const [data, setData] = useState<TaskPageResult | null>(null);
  const [view, setView] = useState<View>("agenda");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [month, setMonth] = useState<CalendarMonth | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({ text: "", folderId: null, tag: null });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const detailRequestRef = useRef(0);
  const serverDataRef = useRef<OkPage | null>(null);
  const pendingWritesRef = useRef(0);
  const queuesRef = useRef(new Map<string, Promise<void>>());

  const folderPaths = useMemo(() => buildFolderPaths(folders), [folders]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    let next: TaskPageResult;
    try {
      next = await getTaskPageAction({ today: todayDayKey() });
    } catch {
      next = { ok: false, error: "Could not load tasks." };
    }
    if (requestId !== requestIdRef.current) return;
    if (next.ok) serverDataRef.current = next;
    if (pendingWritesRef.current === 0) setData(next);
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeDocuments = subscribeToWorkspaceDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), refetchAfterSaveMs);
    });
    const unsubscribeTasks = subscribeToTasksChanged(() => void load());
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribeDocuments();
      unsubscribeTasks();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const ok = data?.ok ? data : null;
  const today = ok?.today ?? todayDayKey();

  const visible = useMemo(
    () =>
      ok
        ? filterTasks(ok.tasks, filters, { folders, tagsByDocument: ok.tagsByDocument })
        : [],
    [ok, filters, folders],
  );

  const changeTask = useCallback(
    (ref: TaskRef, change: TaskChange) => {
      const key = taskKey(ref);
      setNotice(null);
      setData((current) => {
        if (!current?.ok) return current;
        const tasks = current.tasks.flatMap((task) => {
          if (taskKey(task) !== key) return [task];
          const patched = patchTask(task, change, current.today);
          return patched ? [patched] : [];
        });
        return { ...current, tasks };
      });
      pendingWritesRef.current += 1;

      const queues = queuesRef.current;
      const previous = queues.get(ref.documentId) ?? Promise.resolve();
      const run = previous.then(async () => {
        const latest =
          serverDataRef.current?.tasks.find((task) => taskKey(task) === key) ?? ref;
        const result = await updateTaskAction({
          today: todayDayKey(),
          documentId: latest.documentId,
          line: latest.line,
          rawLine: latest.rawLine,
          change,
        }).catch(() => ({ ok: false as const, error: "Could not change the task." }));

        pendingWritesRef.current -= 1;
        if (!result.ok) setNotice(result.error);
        // Refreshes this page and the sidebar agenda alike.
        dispatchTasksChanged();
      });

      queues.set(ref.documentId, run);
      void run.finally(() => {
        if (queues.get(ref.documentId) === run) queues.delete(ref.documentId);
      });
    },
    [],
  );

  const openTask = useCallback(
    (ref: TaskRef) => {
      requestEditorJump({ documentId: ref.documentId, line: ref.line, text: ref.rawLine });
      router.push(`/docs/${ref.documentId}`);
    },
    [router],
  );

  // Detail for the selected task; refetched when the data changes under it.
  useEffect(() => {
    if (!selectedKey) return;
    const [documentId, ordinalText] = selectedKey.split(":");
    const requestId = ++detailRequestRef.current;
    void getTaskDetailAction({ documentId, ordinal: Number(ordinalText) })
      .catch(() => null)
      .then((next) => {
        if (requestId !== detailRequestRef.current) return;
        setDetail(next);
        setDetailLoading(false);
      });
  }, [selectedKey, data]);

  const select = (key: string | null) => {
    setSelectedKey(key);
    setDetailLoading(key !== null);
    if (key === null) setDetail(null);
  };

  const currentWeek = weekStart ?? mondayOf(today);
  const currentMonth: CalendarMonth = month ?? {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  };

  // The tasks in on-screen order, for j/k.
  const ordered = useMemo<PageTask[]>(() => {
    if (!ok) return [];
    if (view === "agenda") {
      return groupAgenda(visible, today, ok.inboxDocumentId, focusDay).flatMap((group) => group.tasks);
    }
    if (view === "week") {
      const byDay = tasksByDay(visible, weekDays(currentWeek));
      return weekDays(currentWeek).flatMap((day) => byDay.get(day) ?? []);
    }
    if (view === "backlog") {
      return groupBacklog(visible, ok.inboxDocumentId).flatMap((group) => group.tasks);
    }
    return [];
  }, [ok, view, visible, today, focusDay, currentWeek]);

  // Keyboard: j/k move, x ticks, t/m schedule, Enter opens, / filters.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")
      ) {
        return;
      }

      const index = ordered.findIndex((task) => taskKey(task) === selectedKey);
      const selected = index >= 0 ? ordered[index] : null;
      const move = (delta: number) => {
        if (ordered.length === 0) return;
        const next = index < 0 ? (delta > 0 ? 0 : ordered.length - 1) : (index + delta + ordered.length) % ordered.length;
        const key = taskKey(ordered[next]);
        select(key);
        document.getElementById(`task-${key}`)?.scrollIntoView({ block: "nearest" });
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "x":
          if (selected) {
            event.preventDefault();
            changeTask(selected, {
              type: "status",
              status: selected.status === "done" ? "open" : "done",
            });
          }
          break;
        case "t":
        case "m":
          if (selected) {
            event.preventDefault();
            changeTask(selected, {
              type: "due",
              day: event.key === "t" ? today : addDaysToDayKey(today, 1),
              time: selected.dueTime,
            });
          }
          break;
        case "Enter":
          if (selected) {
            event.preventDefault();
            openTask(selected);
          }
          break;
        case "/":
          event.preventDefault();
          filterInputRef.current?.focus();
          break;
        case "Escape":
          select(null);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ordered, selectedKey, changeTask, openTask, today]);

  // A day clicked in the Month view: scroll the Agenda to it. Open tasks from
  // a past day live in Overdue, so a past day scrolls there instead.
  useEffect(() => {
    if (view !== "agenda" || !focusDay) return;
    const id = focusDay < today ? "agenda-overdue" : `agenda-day-${focusDay}`;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [view, focusDay, today]);

  const selectedTask = ok?.tasks.find((task) => taskKey(task) === selectedKey) ?? null;
  const rightPanel = (
    <TaskDetailPanel
      detail={detail}
      loading={detailLoading}
      folderPath={
        (detail?.task.folderId ?? selectedTask?.folderId)
          ? (folderPaths.get((detail?.task.folderId ?? selectedTask?.folderId) as string) ?? null)
          : null
      }
      onChange={changeTask}
      onOpen={openTask}
    />
  );

  const rowProps = {
    today,
    folderPaths,
    selectedKey,
    onSelect: (key: string) => select(key),
    onOpen: openTask,
    onChange: changeTask,
  };

  return (
    <>
      <WorkspacePageRegistration page={pageDescriptor} rightPanel={rightPanel} />
      <section className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
              Your documents
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight vault-display">Tasks</h1>
          </div>
          <div role="tablist" aria-label="Task views" className="flex rounded-md border border-border/70 p-0.5">
            {views.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  onClick={() => {
                    setView(item.id);
                    setFocusDay(null);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition",
                    view === item.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={filterInputRef}
              value={filters.text}
              onChange={(event) => setFilters((current) => ({ ...current, text: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Escape") event.currentTarget.blur();
              }}
              placeholder="Filter tasks  ( / )"
              aria-label="Filter tasks"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <select
            aria-label="Folder"
            value={filters.folderId ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, folderId: event.target.value || null }))}
            className="h-8 max-w-[14rem] rounded-md border border-border/70 bg-background px-2 text-sm"
          >
            <option value="">All folders</option>
            {[...folderPaths.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, path]) => (
                <option key={id} value={id}>
                  {path}
                </option>
              ))}
          </select>
          {ok && ok.tags.length > 0 ? (
            <select
              aria-label="Tag"
              value={filters.tag ?? ""}
              onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value || null }))}
              className="h-8 max-w-[12rem] rounded-md border border-border/70 bg-background px-2 text-sm"
            >
              <option value="">All tags</option>
              {ok.tags.map((tag) => (
                <option key={tag.slug} value={tag.slug}>
                  {tag.displayName}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {notice ? (
          <p role="status" className="mt-3 text-sm text-destructive">
            {notice}
          </p>
        ) : null}
        {ok?.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the first 2,000 tasks; filter to narrow the list.
          </p>
        ) : null}

        <div className="mt-4">
          {data === null ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : !data.ok ? (
            <p className="text-sm text-muted-foreground">{data.error}</p>
          ) : view === "agenda" ? (
            <AgendaView
              groups={groupAgenda(visible, today, data.inboxDocumentId, focusDay)}
              {...rowProps}
            />
          ) : view === "week" ? (
            <WeekView
              weekStart={currentWeek}
              byDay={tasksByDay(visible, weekDays(currentWeek))}
              onWeekChange={setWeekStart}
              onReschedule={(key, day) => {
                const task = data.tasks.find((candidate) => taskKey(candidate) === key);
                if (task && task.dueDay !== day) {
                  changeTask(task, { type: "due", day, time: task.dueTime });
                }
              }}
              {...rowProps}
            />
          ) : view === "month" ? (
            <MonthView
              month={currentMonth}
              today={today}
              counts={dayCounts(visible, today)}
              onMonthChange={setMonth}
              onPickDay={(day) => {
                setFocusDay(day);
                setView("agenda");
              }}
            />
          ) : (
            <BacklogView groups={groupBacklog(visible, data.inboxDocumentId)} {...rowProps} />
          )}
        </div>
      </section>
    </>
  );
}

type RowProps = {
  today: string;
  folderPaths: Map<string, string>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpen: (task: TaskRef) => void;
  onChange: (task: TaskRef, change: TaskChange) => void;
};

function TaskItem({
  task,
  today,
  folderPaths,
  selectedKey,
  onSelect,
  onOpen,
  onChange,
  showDue,
  compact = false,
  draggable = false,
}: RowProps & { task: PageTask; showDue: boolean; compact?: boolean; draggable?: boolean }) {
  const key = taskKey(task);
  const done = task.status === "done";
  const overdue = !done && task.dueDay !== null && task.dueDay < today;
  const folder = task.folderId ? folderPaths.get(task.folderId) : null;
  const where = `${folder ? `${folder} / ` : ""}${task.documentTitle}${task.heading ? ` › ${task.heading}` : ""}`;

  return (
    <div
      id={`task-${key}`}
      role="option"
      aria-selected={selectedKey === key}
      tabIndex={-1}
      draggable={draggable}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(dragType, key);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(key)}
      onDoubleClick={() => onOpen(task)}
      className={cn(
        "group grid cursor-default items-start rounded-md py-1.5 transition",
        compact
          ? "grid-cols-[0.95rem_minmax(0,1fr)] gap-x-1.5 px-1.5 text-[0.8rem] leading-snug"
          : "grid-cols-[0.95rem_minmax(0,1fr)_auto_1.5rem] gap-x-2 px-2 text-sm",
        selectedKey === key ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/50",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(event) => {
          event.stopPropagation();
          onChange(task, { type: "status", status: done ? "open" : "done" });
        }}
        className="vault-task-box mt-[0.2rem] cursor-pointer"
        data-status={task.status}
        data-overdue={overdue ? "true" : undefined}
      />
      <span className="min-w-0">
        <span className={cn("vault-task-md block", done ? "text-muted-foreground line-through" : "text-foreground")}>
          {task.text ? (
            <MarkdownDocument markdown={task.text} contained={false} disableLinks />
          ) : (
            <span className="italic text-muted-foreground">Untitled task</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {where}
          {compact && task.dueTime ? ` · ${task.dueTime}` : ""}
        </span>
      </span>
      {compact ? null : (
        <>
          <span className={cn("pt-0.5 text-xs tabular-nums text-muted-foreground", overdue && "text-destructive")}>
            {showDue && task.dueDay ? formatDueLabel(task.dueDay, today) : ""}
            {task.dueTime ? `${showDue && task.dueDay ? " " : ""}${task.dueTime}` : ""}
          </span>
          <span onClick={(event) => event.stopPropagation()}>
            <TaskActionsMenu
              task={task}
              today={today}
              onChange={(change) => onChange(task, change)}
              className="opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            />
          </span>
        </>
      )}
    </div>
  );
}

function GroupHeading({ label, detail, tone }: { label: string; detail?: string; tone?: "danger" }) {
  return (
    <h2
      className={cn(
        "flex items-baseline gap-2 border-b border-border/60 px-2 pb-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em]",
        tone === "danger" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
      {detail ? <span className="font-normal normal-case tracking-normal">{detail}</span> : null}
    </h2>
  );
}

function longDay(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function shortWeekday(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function AgendaView({
  groups,
  ...rowProps
}: RowProps & { groups: ReturnType<typeof groupAgenda<PageTask>> }) {
  if (groups.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        Nothing scheduled. Give a task a date with <code>@</code> in any document, or capture one with{" "}
        <code>/task</code>.
      </p>
    );
  }

  return (
    <div role="listbox" aria-label="Agenda" className="grid gap-5">
      {groups.map((group) => (
        <section
          key={group.id}
          id={group.dayKey ? `agenda-day-${group.dayKey}` : `agenda-${group.id}`}
          className="scroll-mt-4"
        >
          {group.kind === "overdue" ? (
            <GroupHeading label="Overdue" tone="danger" />
          ) : group.kind === "inbox" ? (
            <GroupHeading label="Inbox" detail="no date yet" />
          ) : (
            <GroupHeading
              label={formatDueLabel(group.dayKey as string, rowProps.today)}
              detail={longDay(group.dayKey as string)}
            />
          )}
          <div className="mt-1 grid gap-0.5">
            {group.tasks.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing due.</p>
            ) : (
              group.tasks.map((task) => (
                <TaskItem key={taskKey(task)} task={task} showDue={group.kind === "overdue"} {...rowProps} />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function WeekView({
  weekStart,
  byDay,
  onWeekChange,
  onReschedule,
  ...rowProps
}: RowProps & {
  weekStart: string;
  byDay: Map<string, PageTask[]>;
  onWeekChange: (weekStart: string) => void;
  onReschedule: (key: string, day: string) => void;
}) {
  const [dropDay, setDropDay] = useState<string | null>(null);
  const days = weekDays(weekStart);
  const range = `${longDay(days[0])} – ${longDay(days[6])}`;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <NavButton label="Previous week" onClick={() => onWeekChange(addDaysToDayKey(weekStart, -7))}>
          <ChevronLeft className="size-4" />
        </NavButton>
        <button
          type="button"
          onClick={() => onWeekChange(mondayOf(rowProps.today))}
          className="rounded-md border border-border/70 px-2 py-1 text-xs transition hover:bg-muted"
        >
          This week
        </button>
        <NavButton label="Next week" onClick={() => onWeekChange(addDaysToDayKey(weekStart, 7))}>
          <ChevronRight className="size-4" />
        </NavButton>
        <p className="ml-2 text-sm text-muted-foreground">{range}</p>
      </div>
      <div className="overflow-x-auto pb-2">
        <div role="listbox" aria-label="Week" className="grid min-w-[66rem] grid-cols-7 gap-1.5">
          {days.map((day) => {
            const isToday = day === rowProps.today;
            const tasks = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(dragType)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropDay(day);
                }}
                onDragLeave={() => setDropDay((current) => (current === day ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropDay(null);
                  const key = event.dataTransfer.getData(dragType);
                  if (key) onReschedule(key, day);
                }}
                data-day={day}
                className={cn(
                  "flex min-h-[14rem] flex-col rounded-lg border p-1.5 transition",
                  isToday ? "border-primary/50" : "border-border/60",
                  dropDay === day && "bg-primary/5 ring-1 ring-primary/40",
                  day < rowProps.today && "opacity-80",
                )}
              >
                <p className={cn("px-1 pb-1 text-xs font-semibold", isToday ? "text-primary" : "text-muted-foreground")}>
                  {shortWeekday(day)} <span className="font-normal">{Number(day.slice(8))}</span>
                </p>
                <div className="grid gap-1">
                  {tasks.map((task) => (
                    <div key={taskKey(task)} className="rounded-md border border-border/50 bg-card/40">
                      <TaskItem task={task} showDue={false} compact draggable {...rowProps} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Drag a task to another day to reschedule it.</p>
    </div>
  );
}

function MonthView({
  month,
  today,
  counts,
  onMonthChange,
  onPickDay,
}: {
  month: CalendarMonth;
  today: string;
  counts: Map<string, { open: number; overdue: number }>;
  onMonthChange: (month: CalendarMonth) => void;
  onPickDay: (day: string) => void;
}) {
  const weeks = getMonthMatrix(month, 1, today);
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <NavButton label="Previous month" onClick={() => onMonthChange(addMonths(month, -1))}>
          <ChevronLeft className="size-4" />
        </NavButton>
        <button
          type="button"
          onClick={() =>
            onMonthChange({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })
          }
          className="rounded-md border border-border/70 px-2 py-1 text-xs transition hover:bg-muted"
        >
          This month
        </button>
        <NavButton label="Next month" onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRight className="size-4" />
        </NavButton>
        <p className="ml-2 text-sm font-medium">{formatMonthLabel(month)}</p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {weekdayLabels.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid gap-1">
        {weeks.map((week) => (
          <div key={week[0]?.dayKey} className="grid grid-cols-7 gap-1">
            {week.map((cell) => {
              const count = counts.get(cell.dayKey);
              const open = count?.open ?? 0;
              return (
                <button
                  key={cell.dayKey}
                  type="button"
                  onClick={() => onPickDay(cell.dayKey)}
                  data-day={cell.dayKey}
                  aria-label={`${longDay(cell.dayKey)}: ${open} open task${open === 1 ? "" : "s"}`}
                  className={cn(
                    "flex h-16 flex-col items-start rounded-md border p-1.5 text-left transition hover:bg-muted/50",
                    cell.inMonth ? "border-border/60" : "border-transparent opacity-45",
                    cell.isToday && "border-primary/60",
                  )}
                >
                  <span className={cn("text-xs", cell.isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                    {cell.day}
                  </span>
                  {open > 0 ? (
                    <span className="mt-auto flex flex-wrap items-center gap-0.5">
                      {Array.from({ length: Math.min(open, 5) }, (_, index) => (
                        <span
                          key={index}
                          className={cn(
                            "size-1.5 rounded-full",
                            index < (count?.overdue ?? 0) ? "bg-destructive" : "bg-primary/80",
                          )}
                        />
                      ))}
                      {open > 5 ? <span className="text-[0.62rem] text-muted-foreground">+{open - 5}</span> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Each dot is an open task. Click a day to see it in the Agenda.</p>
    </div>
  );
}

function BacklogView({
  groups,
  ...rowProps
}: RowProps & { groups: ReturnType<typeof groupBacklog<PageTask>> }) {
  if (groups.length === 0) {
    return <p className="px-2 py-6 text-sm text-muted-foreground">No undated tasks outside your Inbox.</p>;
  }

  return (
    <div role="listbox" aria-label="Backlog" className="grid gap-5">
      <p className="px-2 text-xs text-muted-foreground">
        Tasks with no date, by document. Give one a date to put it on the agenda.
      </p>
      {groups.map((group) => (
        <section key={group.documentId}>
          <GroupHeading label={group.documentTitle} detail={`${group.tasks.length}`} />
          <div className="mt-1 grid gap-0.5">
            {group.tasks.map((task) => (
              <TaskItem key={taskKey(task)} task={task} showDue={false} {...rowProps} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
