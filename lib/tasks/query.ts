/**
 * `:::tasks{…}` query blocks (docs/24_TASKS_AND_AGENDA_PLAN.md §6.4): a live
 * task list embedded in any document.
 *
 *   :::tasks{due=week}                 this document's tasks due within a week
 *   :::tasks{scope=all due=today}      the READER's own tasks due today
 *   :::tasks{scope=all tag=work status=all title="Work"}
 *
 * `scope=doc` (the default) lists tasks already written in the document, so it
 * reveals nothing a reader could not already see. `scope=all` lists the
 * viewer's own tasks, never the author's, and shows a note instead on public
 * pages — that is what keeps tasks personal when such a document is shared.
 */

import { addDaysToDayKey } from "@/lib/tasks/dates";
import type { TaskStatus } from "@/lib/tasks/parse";

export type TaskQuery = {
  scope: "doc" | "all";
  due: "any" | "overdue" | "today" | "week" | "month" | "none";
  status: "open" | "done" | "all";
  tag: string | null;
  title: string | null;
};

export const DEFAULT_TASK_QUERY: TaskQuery = {
  scope: "doc",
  due: "any",
  status: "open",
  tag: null,
  title: null,
};

const fencePattern = /^:::tasks(?:\{([^}\n]*)\})?\s*$/i;
const attributePattern = /([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;

/** The query on a `:::tasks{…}` line, or null when the line is not one. */
export function parseTaskQueryFence(line: string): TaskQuery | null {
  const match = fencePattern.exec(line.trim());
  if (!match) return null;

  const query: TaskQuery = { ...DEFAULT_TASK_QUERY };

  for (const attribute of (match[1] ?? "").matchAll(attributePattern)) {
    const key = attribute[1].toLowerCase();
    const value = (attribute[2] ?? attribute[3] ?? attribute[4] ?? "").trim();

    if (key === "scope" && (value === "doc" || value === "all")) query.scope = value;
    if (key === "due" && ["any", "overdue", "today", "week", "month", "none"].includes(value)) {
      query.due = value as TaskQuery["due"];
    }
    if (key === "status" && ["open", "done", "all"].includes(value)) {
      query.status = value as TaskQuery["status"];
    }
    if (key === "tag" && value) query.tag = value.toLowerCase();
    if (key === "title" && value) query.title = value.slice(0, 120);
  }

  return query;
}

export type TaskQuerySegment =
  | { type: "markdown"; markdown: string }
  | { type: "tasks"; query: TaskQuery };

/**
 * Splits markdown around `:::tasks` lines so read-only renderers can mount the
 * block in place. Lines inside fenced code are left alone.
 */
export function splitTaskQuerySegments(markdown: string): TaskQuerySegment[] {
  const segments: TaskQuerySegment[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", markdown: buffer.join("\n") });
      buffer = [];
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMarker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (fenceMarker) {
      if (fence === null) fence = fenceMarker[0];
      else if (fenceMarker[0] === fence) fence = null;
    }

    const query = fence === null ? parseTaskQueryFence(line) : null;

    if (query) {
      flush();
      segments.push({ type: "tasks", query });
    } else {
      buffer.push(line);
    }
  }

  flush();
  return segments;
}

type QueryableTask = {
  status: TaskStatus;
  dueDay: string | null;
  documentId?: string;
};

/** Whether `task` belongs in a block with this query. */
export function matchesTaskQuery(
  task: QueryableTask,
  query: TaskQuery,
  today: string,
  tagsByDocument: Record<string, string[]> = {},
): boolean {
  if (query.status === "open" && task.status !== "open" && task.status !== "in_progress") return false;
  if (query.status === "done" && task.status !== "done") return false;
  if (query.status === "all" && task.status === "cancelled") return false;

  if (query.tag && task.documentId && !(tagsByDocument[task.documentId] ?? []).includes(query.tag)) {
    return false;
  }

  switch (query.due) {
    case "any":
      return true;
    case "none":
      return task.dueDay === null;
    case "overdue":
      return task.dueDay !== null && task.dueDay < today;
    case "today":
      return task.dueDay === today;
    // "Due this week/month" includes what is already late: a planning list
    // that hid overdue work would be lying about the week.
    case "week":
      return task.dueDay !== null && task.dueDay <= addDaysToDayKey(today, 6);
    case "month":
      return task.dueDay !== null && task.dueDay <= addDaysToDayKey(today, 30);
  }
}

/** A readable label for a block's header when it has no `title`. */
export function describeTaskQuery(query: TaskQuery): string {
  if (query.title) return query.title;
  const whose = query.scope === "all" ? "My tasks" : "Tasks in this document";
  const when = {
    any: "",
    overdue: " · overdue",
    today: " · due today",
    week: " · due this week",
    month: " · due this month",
    none: " · no date",
  }[query.due];
  const status = query.status === "done" ? " · done" : query.status === "all" ? " · all" : "";
  return `${whose}${when}${status}${query.tag ? ` · #${query.tag}` : ""}`;
}

/**
 * Task text without Markdown syntax, for surfaces that render plain text:
 * links and wiki links keep their label, emphasis and code markers go.
 */
export function plainTaskText(markdown: string): string {
  return markdown
    .replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/:[A-Za-z][\w-]*\[([^\]]*)\]/g, "$1")
    .trim();
}
