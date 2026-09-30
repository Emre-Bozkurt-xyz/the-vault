/**
 * Pure filtering and grouping behind the Tasks page views (plan §6.2). Kept
 * out of the component so the bucketing rules are tested, not eyeballed.
 * Every function takes the viewer's `today`; nothing reads the clock.
 */

import { addDaysToDayKey } from "@/lib/tasks/dates";
import type { TaskStatus } from "@/lib/tasks/parse";

/** The fields these views need; `PageTask` from the server satisfies it. */
export type ViewTask = {
  documentId: string;
  documentTitle: string;
  folderId: string | null;
  ordinal: number;
  status: TaskStatus;
  text: string;
  heading: string | null;
  dueDay: string | null;
  dueTime: string | null;
};

export type TaskFilters = {
  text: string;
  /** A folder id; matches documents in it or any folder below it. */
  folderId: string | null;
  tag: string | null;
};

export type FolderNode = { id: string; parentId: string | null };

export function taskKey(task: Pick<ViewTask, "documentId" | "ordinal">): string {
  return `${task.documentId}:${task.ordinal}`;
}

/** `folderId` and every folder nested under it. */
export function folderWithDescendants(folders: FolderNode[], folderId: string): Set<string> {
  const result = new Set([folderId]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }

  return result;
}

export function filterTasks<T extends ViewTask>(
  tasks: T[],
  filters: TaskFilters,
  context: { folders: FolderNode[]; tagsByDocument: Record<string, string[]> },
): T[] {
  const terms = filters.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const folders = filters.folderId
    ? folderWithDescendants(context.folders, filters.folderId)
    : null;

  return tasks.filter((task) => {
    if (folders && !(task.folderId && folders.has(task.folderId))) return false;
    if (filters.tag && !(context.tagsByDocument[task.documentId] ?? []).includes(filters.tag)) {
      return false;
    }
    if (terms.length === 0) return true;

    const haystack = `${task.text} ${task.documentTitle} ${task.heading ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function compareViewTasks(a: ViewTask, b: ViewTask): number {
  const day =
    a.dueDay === b.dueDay ? 0 : a.dueDay === null ? 1 : b.dueDay === null ? -1 : a.dueDay.localeCompare(b.dueDay);

  return (
    day ||
    (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
    a.documentTitle.localeCompare(b.documentTitle) ||
    a.ordinal - b.ordinal
  );
}

export type AgendaGroup<T> = {
  /** "overdue", "inbox", or a `YYYY-MM-DD` day key. */
  id: string;
  kind: "overdue" | "day" | "inbox";
  dayKey: string | null;
  tasks: T[];
};

/**
 * Agenda view: Overdue first (open tasks due before today), then one group per
 * day with tasks, then the Inbox's undated tasks. A task ticked today counts
 * as today's, whenever it was due. `focusDay`, when given, always gets a group
 * (possibly empty) so a click in the Month view has somewhere to land.
 */
export function groupAgenda<T extends ViewTask>(
  tasks: T[],
  today: string,
  inboxDocumentId: string | null,
  focusDay: string | null = null,
): Array<AgendaGroup<T>> {
  const overdue: T[] = [];
  const days = new Map<string, T[]>();
  const inbox: T[] = [];

  for (const task of [...tasks].sort(compareViewTasks)) {
    if (task.dueDay === null) {
      if (task.documentId === inboxDocumentId) inbox.push(task);
      continue;
    }

    const done = task.status === "done";
    if (!done && task.dueDay < today) {
      overdue.push(task);
      continue;
    }

    const day = done && task.dueDay < today ? today : task.dueDay;
    const list = days.get(day);
    if (list) list.push(task);
    else days.set(day, [task]);
  }

  if (focusDay && !days.has(focusDay) && focusDay >= today) days.set(focusDay, []);

  const groups: Array<AgendaGroup<T>> = [];
  if (overdue.length) groups.push({ id: "overdue", kind: "overdue", dayKey: null, tasks: overdue });
  for (const day of [...days.keys()].sort()) {
    groups.push({ id: day, kind: "day", dayKey: day, tasks: days.get(day) ?? [] });
  }
  if (inbox.length) groups.push({ id: "inbox", kind: "inbox", dayKey: null, tasks: inbox });
  return groups;
}

/** The seven day keys of the week starting on `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToDayKey(weekStart, index));
}

/** Monday of the week holding `dayKey`. */
export function mondayOf(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysToDayKey(dayKey, -((weekday + 6) % 7));
}

/** Tasks due on each day key of `days` (done ones included, for the day's record). */
export function tasksByDay<T extends ViewTask>(tasks: T[], days: string[]): Map<string, T[]> {
  const wanted = new Set(days);
  const map = new Map<string, T[]>(days.map((day) => [day, []]));

  for (const task of [...tasks].sort(compareViewTasks)) {
    if (task.dueDay && wanted.has(task.dueDay)) map.get(task.dueDay)?.push(task);
  }

  return map;
}

/** Month view density: open tasks per day, and how many of them are overdue. */
export function dayCounts(
  tasks: ViewTask[],
  today: string,
): Map<string, { open: number; overdue: number }> {
  const counts = new Map<string, { open: number; overdue: number }>();

  for (const task of tasks) {
    if (!task.dueDay || task.status === "done") continue;
    const entry = counts.get(task.dueDay) ?? { open: 0, overdue: 0 };
    entry.open += 1;
    if (task.dueDay < today) entry.overdue += 1;
    counts.set(task.dueDay, entry);
  }

  return counts;
}

/** Backlog: undated open tasks outside the Inbox, grouped by document. */
export function groupBacklog<T extends ViewTask>(
  tasks: T[],
  inboxDocumentId: string | null,
): Array<{ documentId: string; documentTitle: string; tasks: T[] }> {
  const groups = new Map<string, { documentId: string; documentTitle: string; tasks: T[] }>();

  for (const task of tasks) {
    if (task.dueDay !== null || task.documentId === inboxDocumentId || task.status === "done") continue;
    const group = groups.get(task.documentId) ?? {
      documentId: task.documentId,
      documentTitle: task.documentTitle,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.documentId, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, tasks: group.tasks.sort((a, b) => a.ordinal - b.ordinal) }))
    .sort((a, b) => a.documentTitle.localeCompare(b.documentTitle));
}
