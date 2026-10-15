"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FileInput,
  FileSearch,
  FileText,
  Flag,
  Inbox,
  Keyboard,
  ListChecks,
  ListTodo,
  Search,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";

import { openWorkspaceSettings } from "@/components/settings/SettingsModalController";
import { useKeybindings } from "@/components/shortcuts/KeybindingsProvider";
import { formatBindingForDisplay } from "@/lib/shortcuts/binding";
import { requestMoveTasks } from "@/components/tasks/MoveTasksDialog";
import { sentenceCase, taskMoveTargets, type TaskMoveTarget } from "@/components/tasks/TaskActionsMenu";
import { TaskDetailPanel, type TaskRef } from "@/components/tasks/TaskDetailPanel";
import { TaskRow } from "@/components/tasks/TaskRow";
import { useLiveDocumentTasks } from "@/components/tasks/use-live-tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { buildFolderPaths, type FolderPathNode } from "@/lib/folder-paths";
import {
  addDaysToDayKey,
  addMonths,
  formatDueLabel,
  formatMonthLabel,
  getMonthMatrix,
  todayDayKey,
  type CalendarMonth,
} from "@/lib/tasks/dates";
import { applyTaskPatches } from "@/lib/tasks/optimistic";
import { inTaskPage, liveRow, mergeLiveTasks } from "@/lib/tasks/overlay";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/parse";
import { runTaskWrite, useTaskPatches, type RowChange } from "@/lib/tasks/task-writes";
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
import { subscribeToTasksChanged } from "@/lib/workspace-toast";
import { getCompletedTasksAction, getTaskDetailAction, getTaskPageAction, type CompletedTasksResult, type TaskPageResult } from "@/server/tasks";
import type { CompletedTask, PageTask, TaskDetail } from "@/server/tasks-data";
import type { WorkspaceAgendaEvent } from "@/lib/extension-api/server";

/**
 * The full Tasks page (docs/24_TASKS_AND_AGENDA_PLAN.md §6.2): Agenda, Week,
 * Month, Backlog and Done views over the viewer's own tasks, with filters,
 * multi-select and bulk actions, keyboard control and a detail panel.
 *
 * Rows come from the server, with documents open in an editor replaced by
 * their live parse and pending writes applied on top (the same pipeline as
 * the sidebar). Grouping lives in `lib/tasks/views.ts`; writes go through
 * `lib/tasks/task-writes.ts`.
 */

type View = "agenda" | "week" | "month" | "backlog" | "done";
type OkPage = Extract<TaskPageResult, { ok: true }>;
type ListTask = PageTask | CompletedTask;

const pageDescriptor = { type: "tasks", title: "Tasks", href: "/tasks" } as const;
const refetchAfterSaveMs = 2500;
const dragType = "application/x-vault-task";

const views: Array<{ id: View; label: string; icon: typeof ListTodo }> = [
  { id: "agenda", label: "Agenda", icon: ListTodo },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "month", label: "Month", icon: CalendarDays },
  { id: "backlog", label: "Backlog", icon: Inbox },
  { id: "done", label: "Done", icon: CircleCheck },
];

const shortcutRows: Array<[string[], string]> = [
  [["j", "k"], "Move down / up"],
  [["Shift", "j / k"], "Extend the selection"],
  [["Ctrl", "click"], "Add a task to the selection"],
  [["Shift", "click"], "Select a range"],
  [["Ctrl", "a"], "Select every listed task"],
  [["x"], "Done / not done"],
  [["t"], "Due today"],
  [["m"], "Due tomorrow"],
  [["p"], "Next priority"],
  [["e"], "Edit text"],
  [["Delete"], "Delete (with Undo)"],
  [["Enter"], "Open at its line"],
  [["/"], "Filter"],
  [["Esc"], "Clear the selection"],
];

export function TasksPage({ enabled, folders }: { enabled: boolean; folders: FolderPathNode[] }) {
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

const nextPriority: Record<string, TaskPriority | null> = { none: "high", high: "medium", medium: "low", low: null };

function TasksWorkspace({ folders }: { folders: FolderPathNode[] }) {
  const router = useRouter();
  const [data, setData] = useState<TaskPageResult | null>(null);
  const [completed, setCompleted] = useState<CompletedTasksResult | null>(null);
  const [view, setView] = useState<View>("agenda");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [month, setMonth] = useState<CalendarMonth | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({ text: "", folderId: null, tag: null });
  /** The keyboard cursor; its task fills the detail panel. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** An explicit multi-selection (Ctrl/Shift-click, Shift+j/k). */
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const detailRequestRef = useRef(0);
  const live = useLiveDocumentTasks();
  const patches = useTaskPatches();

  const folderPaths = useMemo(() => buildFolderPaths(folders), [folders]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const today = todayDayKey();
    const [next, done] = await Promise.all([
      getTaskPageAction({ today }).catch((): TaskPageResult => ({ ok: false, error: "Could not load tasks." })),
      getCompletedTasksAction({ today }).catch(
        (): CompletedTasksResult => ({ ok: false, error: "Could not load completed tasks." }),
      ),
    ]);
    if (requestId !== requestIdRef.current) return;
    setData(next);
    setCompleted(done);
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

  const ok: OkPage | null = data?.ok ? data : null;
  const today = ok?.today ?? todayDayKey();
  const tagsByDocument = ok?.tagsByDocument;

  const tasks = useMemo<PageTask[]>(() => {
    if (!ok) return [];
    const merged = mergeLiveTasks(ok.tasks, live, {
      ownedOnly: true,
      include: (task) => inTaskPage(task, ok.today),
      build: (task, document) => liveRow(task, document),
    });
    return applyTaskPatches(merged, patches, ok.today).filter((task) => inTaskPage(task, ok.today));
  }, [ok, live, patches]);

  const visible = useMemo(
    () => (ok ? filterTasks(tasks, filters, { folders, tagsByDocument: ok.tagsByDocument }) : []),
    [ok, tasks, filters, folders],
  );

  const doneTasks = useMemo<CompletedTask[]>(() => {
    if (!completed?.ok) return [];
    const patched = applyTaskPatches(completed.tasks, patches, today).filter(
      (task): task is CompletedTask => task.status === "done" && Boolean(task.doneDay),
    );
    return filterTasks(patched, filters, { folders, tagsByDocument: tagsByDocument ?? {} });
  }, [completed, patches, today, filters, folders, tagsByDocument]);

  const moveTargets = useMemo(() => taskMoveTargets(tasks, ok?.inboxDocumentId ?? null), [tasks, ok?.inboxDocumentId]);

  const currentWeek = weekStart ?? mondayOf(today);
  const currentMonth: CalendarMonth = month ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

  // The tasks in on-screen order, for j/k, ranges and select-all.
  const ordered = useMemo<ListTask[]>(() => {
    if (!ok) return [];
    if (view === "agenda") return groupAgenda(visible, today, ok.inboxDocumentId, focusDay).flatMap((group) => group.tasks);
    if (view === "week") {
      const byDay = tasksByDay(visible, weekDays(currentWeek));
      return weekDays(currentWeek).flatMap((day) => byDay.get(day) ?? []);
    }
    if (view === "backlog") return groupBacklog(visible, ok.inboxDocumentId).flatMap((group) => group.tasks);
    if (view === "done") return groupDone(doneTasks).flatMap((group) => group.tasks);
    return [];
  }, [ok, view, visible, today, focusDay, currentWeek, doneTasks]);

  const byKey = useMemo(() => new Map(ordered.map((task) => [taskKey(task), task])), [ordered]);
  const focused = (focusKey && byKey.get(focusKey)) || null;
  const selectedTasks = useMemo(
    () => ordered.filter((task) => selection.has(taskKey(task))),
    [ordered, selection],
  );

  /** What an action applies to: the selection, else the focused task. */
  const targetsFor = useCallback(
    (row?: ListTask): ListTask[] => {
      if (row && !selection.has(taskKey(row))) return [row];
      if (selectedTasks.length > 0) return selectedTasks;
      return focused ? [focused] : [];
    },
    [selection, selectedTasks, focused],
  );

  const apply = useCallback(
    (change: RowChange, row?: ListTask) => {
      const targets = targetsFor(row);
      if (targets.length === 0) return;
      void runTaskWrite(targets, change);
      if (change.type === "delete" || change.type === "move") setSelection(new Set());
    },
    [targetsFor],
  );

  const openTask = useCallback(
    (task: TaskRef) => {
      requestEditorJump({ documentId: task.documentId, line: task.line, text: task.rawLine });
      router.push(`/docs/${task.documentId}`);
    },
    [router],
  );

  const focusOn = (key: string | null) => {
    setFocusKey(key);
    if (key) document.getElementById(`task-${key}`)?.scrollIntoView({ block: "nearest" });
  };

  const selectRange = (fromKey: string | null, toKey: string) => {
    const from = ordered.findIndex((task) => taskKey(task) === fromKey);
    const to = ordered.findIndex((task) => taskKey(task) === toKey);
    if (to === -1) return;
    const [start, end] = from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
    setSelection(new Set(ordered.slice(start, end + 1).map(taskKey)));
  };

  const onRowClick = (task: ListTask, event: MouseEvent) => {
    const key = taskKey(task);
    if (event.shiftKey) {
      event.preventDefault();
      selectRange(focusKey, key);
    } else if (event.metaKey || event.ctrlKey) {
      setSelection((current) => {
        const next = new Set(current);
        // The first Ctrl-click also keeps the task that was already focused.
        if (next.size === 0 && focusKey && focusKey !== key) next.add(focusKey);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      setSelection(new Set());
    }
    setFocusKey(key);
  };

  // Detail for the focused task; refetched when the data changes under it.
  useEffect(() => {
    if (!focusKey) return;
    const [documentId, ordinalText] = focusKey.split(":");
    const requestId = ++detailRequestRef.current;
    void getTaskDetailAction({ documentId, ordinal: Number(ordinalText) })
      .catch(() => null)
      .then((next) => {
        if (requestId === detailRequestRef.current) setDetail(next);
      });
  }, [focusKey, data]);

  // Keyboard: see `shortcutRows`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")
      ) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "a" && ordered.length > 0) {
        event.preventDefault();
        setSelection(new Set(ordered.map(taskKey)));
        return;
      }
      if (mod) return;

      const index = ordered.findIndex((task) => taskKey(task) === focusKey);
      const move = (delta: number) => {
        if (ordered.length === 0) return;
        const next = index < 0 ? (delta > 0 ? 0 : ordered.length - 1) : Math.min(Math.max(index + delta, 0), ordered.length - 1);
        const key = taskKey(ordered[next]);
        if (event.shiftKey) {
          setSelection((current) => {
            const selected = new Set(current);
            if (focusKey) selected.add(focusKey);
            selected.add(key);
            return selected;
          });
        } else {
          setSelection(new Set());
        }
        focusOn(key);
      };
      const targets = targetsFor();

      switch (event.key) {
        case "j":
        case "J":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "x":
          if (targets.length) {
            event.preventDefault();
            const allDone = targets.every((task) => task.status === "done");
            apply({ type: "status", status: allDone ? "open" : "done" });
          }
          break;
        case "t":
        case "m":
          if (targets.length) {
            event.preventDefault();
            const day = event.key === "t" ? today : addDaysToDayKey(today, 1);
            if (targets.length === 1) apply({ type: "due", day, time: targets[0].dueTime });
            else apply({ type: "due", day });
          }
          break;
        case "p":
          if (targets.length) {
            event.preventDefault();
            apply({ type: "priority", priority: nextPriority[targets[0].priority ?? "none"] });
          }
          break;
        case "e":
          if (focused && selection.size <= 1) {
            event.preventDefault();
            setEditingKey(taskKey(focused));
          }
          break;
        case "Delete":
        case "Backspace":
          if (targets.length) {
            event.preventDefault();
            // Undo lives in the toast, so no confirmation step.
            const after = ordered.slice(index + 1).find((task) => !targets.includes(task));
            apply({ type: "delete" });
            setFocusKey(after ? taskKey(after) : null);
          }
          break;
        case "Enter":
          if (focused) {
            event.preventDefault();
            openTask(focused);
          }
          break;
        case "/":
          event.preventDefault();
          filterInputRef.current?.focus();
          break;
        case "?":
          event.preventDefault();
          setHelpOpen(true);
          break;
        case "Escape":
          if (selection.size > 0) setSelection(new Set());
          else setFocusKey(null);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ordered, focusKey, focused, selection, targetsFor, apply, openTask, today]);

  // A day clicked in the Month view: scroll the Agenda to it. Open tasks from
  // a past day live in Overdue, so a past day scrolls there instead.
  useEffect(() => {
    if (view !== "agenda" || !focusDay) return;
    const id = focusDay < today ? "agenda-overdue" : `agenda-day-${focusDay}`;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [view, focusDay, today]);

  const folderOf = (folderId: string | null) => (folderId ? (folderPaths.get(folderId) ?? null) : null);
  const showDetail = selection.size <= 1 && focusKey && detail && taskKey(detail.task) === focusKey;
  const rightPanel = (
    <TaskDetailPanel
      detail={showDetail ? detail : null}
      today={today}
      loading={Boolean(focusKey) && !showDetail && selection.size <= 1}
      selectedCount={selection.size > 1 ? selection.size : 0}
      folderPath={showDetail && detail ? folderOf(detail.task.folderId) : null}
      onChange={(task, change) => void runTaskWrite([task], change)}
      onOpen={openTask}
      onShowShortcuts={() => setHelpOpen(true)}
    />
  );

  const rowProps: RowProps = {
    today,
    folderOf,
    focusKey,
    selection,
    editingKey,
    moveTargets,
    onEditingChange: (key, editing) => setEditingKey(editing ? key : null),
    onRowClick,
    onOpen: openTask,
    onChange: apply,
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Keyboard className="size-4" />
            </button>
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
                      setSelection(new Set());
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition",
                      view === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
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

        {ok?.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">Showing the first 2,000 tasks; filter to narrow the list.</p>
        ) : null}

        {selectedTasks.length > 0 ? (
          <BulkBar
            tasks={selectedTasks}
            today={today}
            moveTargets={moveTargets}
            onChange={(change) => apply(change)}
            onClear={() => setSelection(new Set())}
          />
        ) : null}

        <div className="mt-4">
          {data === null ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : !data.ok ? (
            <p className="text-sm text-muted-foreground">{data.error}</p>
          ) : view === "agenda" ? (
            <AgendaView
              groups={groupAgenda(visible, today, data.inboxDocumentId, focusDay)}
              events={data.events}
              onMoveOverdue={(overdue) => void runTaskWrite(overdue, { type: "due", day: today })}
              {...rowProps}
            />
          ) : view === "week" ? (
            <WeekView
              weekStart={currentWeek}
              byDay={tasksByDay(visible, weekDays(currentWeek))}
              onWeekChange={setWeekStart}
              onReschedule={(key, day) => {
                const task = byKey.get(key);
                if (!task || task.dueDay === day) return;
                const targets = targetsFor(task);
                if (targets.length === 1) void runTaskWrite(targets, { type: "due", day, time: task.dueTime });
                else void runTaskWrite(targets, { type: "due", day });
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
          ) : view === "backlog" ? (
            <BacklogView groups={groupBacklog(visible, data.inboxDocumentId)} {...rowProps} />
          ) : (
            <DoneView result={completed} groups={groupDone(doneTasks)} {...rowProps} />
          )}
        </div>
      </section>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
            {shortcutRows.map(([keys, label]) => (
              <div key={label} className="contents">
                <dt className="flex gap-1">
                  {keys.map((key) => (
                    <Key key={key}>{key}</Key>
                  ))}
                </dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            With tasks selected, <Key>x</Key> <Key>t</Key> <Key>m</Key> <Key>p</Key> and <Key>Delete</Key> act on all of
            them.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border/70 bg-muted/40 px-1 font-mono text-[0.68rem] text-foreground">
      {children}
    </kbd>
  );
}

/** The user's current binding for a global shortcut, as a key cap. */
function ShortcutKey({ id }: { id: string }) {
  const { bindings, isMac } = useKeybindings();
  const label = formatBindingForDisplay(bindings[id] ?? "", isMac);
  return label ? <Key>{label}</Key> : <span>the Quick add shortcut</span>;
}

/**
 * The bar above the list while tasks are selected: the same actions as a
 * task's menu, applied to all of them. Undo comes with deletes and moves.
 */
function BulkBar({
  tasks,
  today,
  moveTargets,
  onChange,
  onClear,
}: {
  tasks: ListTask[];
  today: string;
  moveTargets: TaskMoveTarget[];
  onChange: (change: RowChange) => void;
  onClear: () => void;
}) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const allDone = tasks.every((task) => task.status === "done");
  const sources = new Set(tasks.map((task) => task.documentId));
  const targets = moveTargets.filter((target) => !(sources.size === 1 && sources.has(target.id)));

  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="sticky top-2 z-20 mt-4 flex items-start gap-1 rounded-lg border border-border/70 bg-popover/95 px-2 py-1.5 text-popover-foreground shadow-sm backdrop-blur"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
        <span className="px-1.5 text-sm font-medium tabular-nums">{tasks.length} selected</span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ type: "status", status: allDone ? "open" : "done" })}
        >
          <CircleCheck /> {allDone ? "Reopen" : "Done"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange({ type: "due", day: today })}>
          <Sun /> Today
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange({ type: "due", day: addDaysToDayKey(today, 1) })}>
          <Sunrise /> Tomorrow
        </Button>
        <span className="relative inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              try {
                dateInputRef.current?.showPicker();
              } catch {
                dateInputRef.current?.focus();
              }
            }}
          >
            <CalendarClock /> Date…
          </Button>
          <input
            ref={dateInputRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              if (event.target.value) onChange({ type: "due", day: event.target.value });
            }}
            className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
          />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <Flag /> Priority
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {TASK_PRIORITIES.map((priority) => (
                <DropdownMenuItem key={priority} onClick={() => onChange({ type: "priority", priority })}>
                  {sentenceCase(priority)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => onChange({ type: "priority", priority: null })}>No priority</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            <FileInput /> Move
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-72">
            <DropdownMenuGroup>
              {targets.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  onClick={() => onChange({ type: "move", targetDocumentId: target.id, targetTitle: target.title })}
                >
                  {target.inbox ? <Inbox /> : <FileText />}
                  <span className="truncate">{target.title}</span>
                </DropdownMenuItem>
              ))}
              {targets.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onClick={() => requestMoveTasks(tasks)}>
                <FileSearch /> Other document…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onChange({ type: "delete" })}
        >
          <Trash2 /> Delete
        </Button>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}

type RowProps = {
  today: string;
  folderOf: (folderId: string | null) => string | null;
  focusKey: string | null;
  selection: ReadonlySet<string>;
  editingKey: string | null;
  moveTargets: TaskMoveTarget[];
  onEditingChange: (key: string, editing: boolean) => void;
  onRowClick: (task: ListTask, event: MouseEvent) => void;
  onOpen: (task: TaskRef) => void;
  onChange: (change: RowChange, row?: ListTask) => void;
};

function PageRow({
  task,
  showDue,
  compact = false,
  trailing,
  ...props
}: RowProps & { task: ListTask; showDue: boolean; compact?: boolean; trailing?: React.ReactNode }) {
  const key = taskKey(task);
  const folder = props.folderOf(task.folderId);
  const where = `${folder ? `${folder} / ` : ""}${task.documentTitle}${task.heading ? ` › ${task.heading}` : ""}`;

  return (
    <TaskRow
      id={`task-${key}`}
      task={task}
      today={props.today}
      variant={compact ? "compact" : "page"}
      context={where}
      showDue={showDue}
      focused={props.focusKey === key}
      selected={props.selection.has(key)}
      editing={props.editingKey === key}
      onEditingChange={(editing) => props.onEditingChange(key, editing)}
      onSelect={(event) => props.onRowClick(task, event)}
      onOpen={() => props.onOpen(task)}
      onChange={(change) => props.onChange(change, task)}
      moveTargets={props.moveTargets}
      draggable={compact}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(dragType, key);
        event.dataTransfer.effectAllowed = "move";
      }}
      trailing={trailing}
    />
  );
}

function GroupHeading({
  label,
  detail,
  tone,
  action,
}: {
  label: string;
  detail?: string;
  tone?: "danger";
  action?: React.ReactNode;
}) {
  return (
    <h2
      className={cn(
        "flex items-baseline gap-2 border-b border-border/60 px-2 pb-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em]",
        tone === "danger" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
      {detail ? <span className="font-normal normal-case tracking-normal">{detail}</span> : null}
      {action ? <span className="ml-auto font-normal normal-case tracking-normal">{action}</span> : null}
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
  events,
  onMoveOverdue,
  ...rowProps
}: RowProps & {
  groups: ReturnType<typeof groupAgenda<PageTask>>;
  events: WorkspaceAgendaEvent[];
  onMoveOverdue: (tasks: PageTask[]) => void;
}) {
  const byDay = new Map<string, WorkspaceAgendaEvent[]>();
  for (const event of events) {
    const list = byDay.get(event.day) ?? [];
    list.push(event);
    byDay.set(event.day, list);
  }
  const present = new Set(groups.filter((group) => group.dayKey).map((group) => group.dayKey));
  const eventGroups = [...byDay.keys()].filter((day) => !present.has(day)).map((day) => ({
    id: day, kind: "day" as const, dayKey: day, tasks: [] as PageTask[],
  }));
  const allGroups = [...groups, ...eventGroups].sort((a, b) => {
    if (a.kind === "overdue") return -1;
    if (b.kind === "overdue") return 1;
    if (a.kind === "inbox") return 1;
    if (b.kind === "inbox") return -1;
    return (a.dayKey ?? "").localeCompare(b.dayKey ?? "");
  });
  if (allGroups.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        Nothing scheduled. Give a task a date with <code>@</code> in any document, or add one with{" "}
        <ShortcutKey id="global.quickAddTask" />.
      </p>
    );
  }

  return (
    <div role="listbox" aria-label="Agenda" aria-multiselectable="true" className="grid gap-5">
      {allGroups.map((group) => (
        <section
          key={group.id}
          id={group.dayKey ? `agenda-day-${group.dayKey}` : `agenda-${group.id}`}
          className="scroll-mt-4"
        >
          {group.kind === "overdue" ? (
            <GroupHeading
              label="Overdue"
              tone="danger"
              action={
                <button
                  type="button"
                  onClick={() => onMoveOverdue(group.tasks)}
                  className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Move all to today
                </button>
              }
            />
          ) : group.kind === "inbox" ? (
            <GroupHeading label="Inbox" detail="no date yet" />
          ) : (
            <GroupHeading
              label={formatDueLabel(group.dayKey as string, rowProps.today)}
              detail={longDay(group.dayKey as string)}
            />
          )}
          <div className="mt-1 grid gap-0.5">
            {group.tasks.length === 0 && (byDay.get(group.dayKey ?? "") ?? []).length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing due.</p>
            ) : (
              group.tasks.map((task) => (
                <PageRow key={taskKey(task)} task={task} showDue={group.kind === "overdue"} {...rowProps} />
              ))
            )}
            {(byDay.get(group.dayKey ?? "") ?? []).map((event) => (
              <Link key={event.id} href={`/docs/${event.documentId}`}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{event.text || "Untitled event"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{event.documentTitle}{event.time ? ` · ${event.time}` : ""}</span>
                </span>
              </Link>
            ))}
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
        <div role="listbox" aria-label="Week" aria-multiselectable="true" className="grid min-w-[66rem] grid-cols-7 gap-1.5">
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
                      <PageRow task={task} showDue={false} compact {...rowProps} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a task to another day to reschedule it; selected tasks move together.
      </p>
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
          onClick={() => onMonthChange({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}
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
    <div role="listbox" aria-label="Backlog" aria-multiselectable="true" className="grid gap-5">
      <p className="px-2 text-xs text-muted-foreground">
        Tasks with no date, by document. Give one a date to put it on the agenda.
      </p>
      {groups.map((group) => (
        <section key={group.documentId}>
          <GroupHeading label={group.documentTitle} detail={`${group.tasks.length}`} />
          <div className="mt-1 grid gap-0.5">
            {group.tasks.map((task) => (
              <PageRow key={taskKey(task)} task={task} showDue={false} {...rowProps} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Completed tasks by the day they were done, newest first. */
function groupDone(tasks: CompletedTask[]): Array<{ day: string; tasks: CompletedTask[] }> {
  const groups = new Map<string, CompletedTask[]>();
  for (const task of tasks) groups.set(task.doneDay, [...(groups.get(task.doneDay) ?? []), task]);
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => ({ day, tasks: list }));
}

function DoneView({
  result,
  groups,
  ...rowProps
}: RowProps & { result: CompletedTasksResult | null; groups: ReturnType<typeof groupDone> }) {
  if (result === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!result.ok) return <p className="text-sm text-muted-foreground">{result.error}</p>;
  if (groups.length === 0) {
    return <p className="px-2 py-6 text-sm text-muted-foreground">Nothing completed in the last 30 days.</p>;
  }

  return (
    <div role="listbox" aria-label="Done" aria-multiselectable="true" className="grid gap-5">
      <p className="px-2 text-xs text-muted-foreground">
        Tasks ticked in Vault over the last 30 days. Untick one to reopen it.
      </p>
      {groups.map((group) => (
        <section key={group.day}>
          <GroupHeading
            label={formatDueLabel(group.day, rowProps.today)}
            detail={`${longDay(group.day)} · ${group.tasks.length}`}
          />
          <div className="mt-1 grid gap-0.5">
            {group.tasks.map((task) => (
              <PageRow key={taskKey(task)} task={task} showDue {...rowProps} />
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
