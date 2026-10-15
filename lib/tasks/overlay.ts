/**
 * Live task overlay (docs/24_TASKS_AND_AGENDA_PLAN.md §5.4).
 *
 * The server's task lists trail the editor: they read `documents.markdown`,
 * which the collab server stores on a debounce. A document open in an editor
 * in this tab has fresher text than that, so the editor publishes its parsed
 * tasks here (`publishLiveDocumentTasks`) and every list merges them over the
 * server rows for that document (`mergeLiveTasks`). Typing `- [ ] Call Sam
 * @fri` shows up in the sidebar without waiting for a save.
 *
 * The store is per tab and holds only documents the user has open. Rows built
 * from it use the same parser, ordinals and line handles the index will have
 * after the next store, so writes through them resolve the same way.
 */

import type { ParsedTask, TaskPriority, TaskStatus } from "@/lib/tasks/parse";

export type LiveDocumentTasks = {
  documentId: string;
  title: string;
  folderId: string | null;
  /** Personal lists (agenda, Tasks page) only take documents the viewer owns. */
  owned: boolean;
  tasks: ParsedTask[];
};

type Listener = () => void;

let snapshot: ReadonlyMap<string, LiveDocumentTasks> = new Map();
const listeners = new Set<Listener>();

function emit(next: Map<string, LiveDocumentTasks>) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function publishLiveDocumentTasks(entry: LiveDocumentTasks) {
  const next = new Map(snapshot);
  next.set(entry.documentId, entry);
  emit(next);
}

export function clearLiveDocumentTasks(documentId: string) {
  if (!snapshot.has(documentId)) return;
  const next = new Map(snapshot);
  next.delete(documentId);
  emit(next);
}

export function subscribeToLiveDocumentTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLiveDocumentTasks(): ReadonlyMap<string, LiveDocumentTasks> {
  return snapshot;
}

const emptySnapshot: ReadonlyMap<string, LiveDocumentTasks> = new Map();

/** For `useSyncExternalStore`'s server snapshot: no editor is open during SSR. */
export function getServerLiveDocumentTasks(): ReadonlyMap<string, LiveDocumentTasks> {
  return emptySnapshot;
}

/** The fields every task list row shares; `AgendaTask` and `PageTask` satisfy it. */
export type LiveTaskRow = {
  documentId: string;
  documentTitle: string;
  ordinal: number;
  line: number;
  rawLine: string;
  parentOrdinal: number | null;
  status: TaskStatus;
  text: string;
  heading: string | null;
  dueDay: string | null;
  dueTime: string | null;
  doneDay: string | null;
  priority: TaskPriority | null;
  repeat: string | null;
};

/** A row built from a live parse; `extra` fills surface-specific fields. */
export function liveRow(task: ParsedTask, document: LiveDocumentTasks): LiveTaskRow & {
  folderId: string | null;
  note: string | null;
} {
  return {
    documentId: document.documentId,
    documentTitle: document.title || "Untitled document",
    folderId: document.folderId,
    ordinal: task.ordinal,
    line: task.line,
    rawLine: task.rawLine,
    parentOrdinal: task.parentOrdinal,
    status: task.status,
    text: task.text,
    note: task.note,
    heading: task.heading,
    dueDay: task.dueDay,
    dueTime: task.dueTime,
    doneDay: task.doneDay,
    priority: task.priority,
    repeat: task.repeat,
  };
}

/**
 * Replaces each live document's server rows with rows from its live parse.
 * `include` is the surface's own filter (what the server query would have
 * returned); `build` turns a parsed task into the surface's row type.
 */
export function mergeLiveTasks<T extends { documentId: string }>(
  rows: T[],
  live: ReadonlyMap<string, LiveDocumentTasks>,
  options: {
    ownedOnly: boolean;
    include: (task: ParsedTask, document: LiveDocumentTasks) => boolean;
    build: (task: ParsedTask, document: LiveDocumentTasks) => T;
  },
): T[] {
  if (live.size === 0) return rows;
  const documents = [...live.values()].filter((document) => !options.ownedOnly || document.owned);
  if (documents.length === 0) return rows;

  const replaced = new Set(documents.map((document) => document.documentId));
  return [
    ...rows.filter((row) => !replaced.has(row.documentId)),
    ...documents.flatMap((document) =>
      document.tasks
        .filter((task) => options.include(task, document))
        .map((task) => options.build(task, document)),
    ),
  ];
}

/** What the sidebar agenda query returns (`listAgendaTasks`), as a predicate. */
export function inAgenda(
  task: Pick<ParsedTask, "status" | "dueDay" | "doneDay">,
  context: { documentId: string; today: string; through: string; inboxDocumentId: string | null },
): boolean {
  const open = task.status === "open" || task.status === "in_progress";
  const doneToday = task.status === "done" && task.doneDay === context.today;
  if (task.dueDay === null) return context.documentId === context.inboxDocumentId && (open || doneToday);
  return (open && task.dueDay <= context.through) || doneToday;
}

/** What the Tasks page query returns (`listTaskPageData`), as a predicate. */
export function inTaskPage(task: Pick<ParsedTask, "status" | "doneDay">, today: string): boolean {
  return task.status === "open" || task.status === "in_progress" || (task.status === "done" && task.doneDay === today);
}
