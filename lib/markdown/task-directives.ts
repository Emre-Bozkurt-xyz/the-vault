/**
 * Read-mode rendering for task syntax (docs/23_TASKS_AND_AGENDA_PLAN.md §3, §7).
 *
 * - `[/]` (in progress) and `[-]` (cancelled) list items: GFM only knows
 *   `[ ]` and `[x]`, so these arrive as paragraph text starting "[/] ". The
 *   plugin strips the marker, makes the item a GFM task (so it renders a
 *   checkbox like any other) and tags it `data-task-status` for styling.
 * - `:due[…]` / `:done[…]` on a task item become `<vault-task-date>`, mapped to
 *   a date chip by MarkdownDocument. A directive outside a task, or with an
 *   invalid value, is left for the calc plugin to restore as literal text.
 *
 * Deterministic on purpose: this runs in server components and static renders
 * (public pages), so it never reads the clock. Relative labels ("Tomorrow",
 * overdue colouring) are Live mode's job.
 */

import { isValidDayKey } from "@/lib/calendar";
import { TASK_TIME_PATTERN } from "@/lib/tasks/parse";

export const TASK_DATE_ELEMENT_NAME = "vault-task-date";
export const TASK_PROGRESS_ELEMENT_NAME = "vault-task-progress";

type MdastNode = {
  type: string;
  name?: string;
  value?: string;
  checked?: boolean | null;
  children?: MdastNode[];
  data?: Record<string, unknown>;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

const extraMarkerPattern = /^\[([/-])\][ \t]+/;

function readValue(source: string | null, node: MdastNode): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (source === null || start === undefined || end === undefined) return null;

  const match = /^:[A-Za-z][\w-]*\[([^\]\n]*)\]/.exec(source.slice(start, end));
  return match ? match[1].trim() : null;
}

/** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` for due; a bare day for done. */
export function isValidTaskDateValue(name: string, value: string | null): boolean {
  if (!value) return false;
  const [day, time, ...rest] = value.split(/\s+/);
  if (!day || rest.length > 0 || !isValidDayKey(day)) return false;
  if (time === undefined) return true;
  return name === "due" && TASK_TIME_PATTERN.test(time);
}

/** Turns a leading `[/] ` or `[-] ` in an item's first paragraph into a task status. */
function claimExtraMarker(item: MdastNode) {
  if (item.checked !== null && item.checked !== undefined) return;

  const paragraph = item.children?.[0];
  const first = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;

  if (first?.type !== "text" || typeof first.value !== "string") return;

  const marker = extraMarkerPattern.exec(first.value);
  if (!marker) return;

  first.value = first.value.slice(marker[0].length);
  item.checked = false;
  item.data = {
    ...item.data,
    hProperties: {
      ...(item.data?.hProperties as Record<string, unknown> | undefined),
      "data-task-status": marker[1] === "/" ? "in_progress" : "cancelled",
    },
  };
}

export function remarkTasks() {
  return function transform(tree: unknown, file?: { value?: unknown }) {
    const source = typeof file?.value === "string" ? file.value : null;

    const visit = (node: MdastNode, inTask: boolean): void => {
      let childInTask = inTask;

      if (node.type === "listItem") {
        claimExtraMarker(node);
        childInTask = node.checked === true || node.checked === false;
      }

      for (const child of node.children ?? []) {
        if (
          childInTask &&
          child.type === "textDirective" &&
          (child.name === "due" || child.name === "done")
        ) {
          const value = readValue(source, child);

          if (isValidTaskDateValue(child.name, value)) {
            // Claimed by `hName`; the calc plugin's restore step skips it.
            child.data = {
              ...child.data,
              hName: TASK_DATE_ELEMENT_NAME,
              hProperties: { "data-kind": child.name, "data-value": value },
            };
            child.children = [];
            continue;
          }
        }

        visit(child, child.type === "list" ? false : childInTask);
      }
    };

    visit(tree as MdastNode, false);
    addSubtaskProgress(tree as MdastNode);
  };
}

function isTaskItem(node: MdastNode): boolean {
  return node.type === "listItem" && (node.checked === true || node.checked === false);
}

function taskStatusOf(node: MdastNode): string {
  const status = (node.data?.hProperties as Record<string, unknown> | undefined)?.["data-task-status"];
  if (typeof status === "string") return status;
  return node.checked ? "done" : "open";
}

/**
 * Appends `<vault-task-progress data-done data-total>` to each task item that
 * has direct subtasks. A second pass, after `[/]`/`[-]` children were claimed
 * in the first, so cancelled subtasks are known and left out of the count.
 */
function addSubtaskProgress(node: MdastNode): void {
  for (const child of node.children ?? []) addSubtaskProgress(child);

  if (!isTaskItem(node)) return;

  let done = 0;
  let total = 0;

  for (const list of node.children ?? []) {
    if (list.type !== "list") continue;
    for (const item of list.children ?? []) {
      if (!isTaskItem(item)) continue;
      const status = taskStatusOf(item);
      if (status === "cancelled") continue;
      total += 1;
      if (status === "done") done += 1;
    }
  }

  const paragraph = node.children?.[0];
  if (total === 0 || paragraph?.type !== "paragraph") return;

  paragraph.children = [
    ...(paragraph.children ?? []),
    {
      type: "taskProgress",
      data: {
        hName: TASK_PROGRESS_ELEMENT_NAME,
        hProperties: { "data-done": String(done), "data-total": String(total) },
      },
      children: [],
    },
  ];
}

const weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthShort = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Fri 2 Oct 2026" / "Fri 2 Oct 2026, 14:30" — clock-free, for server renders. */
export function formatTaskDateAbsolute(value: string): string {
  const [day, time] = value.split(/\s+/);
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const label = `${weekdayShort[weekday]} ${date} ${monthShort[month - 1]} ${year}`;
  return time ? `${label}, ${time}` : label;
}
