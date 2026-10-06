import "server-only";

import { z } from "zod";

import { defineServer } from "@/lib/extension-api/server";
import { addDaysToDayKey, isValidDayKey, todayDayKey } from "@/lib/extension-api/dates";

import manifest from "./manifest";

/**
 * Agent actions over Markdown task lines (`- [ ] … :due[…]`) through the task
 * host service (`docs/24_TASKS_AND_AGENDA_PLAN.md` §8). The workspace listing
 * reads the user's task index (documents they own); the document actions read
 * and edit one document's live text, so they also work in shared documents
 * the user can edit.
 */

const statusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);

const dayKeySchema = z
  .string()
  .refine(isValidDayKey, "Must be a real YYYY-MM-DD date.");

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM (24-hour).");

const todayInput = dayKeySchema
  .optional()
  .describe(
    "The user's local date (YYYY-MM-DD). Pass it whenever you know it: 'overdue', 'today', and done stamps are relative to it. Defaults to the server's date.",
  );

const taskSchema = z.object({
  documentId: z.string(),
  documentTitle: z.string(),
  folderPath: z.string().nullable().describe("Folder path of the document, null at the root."),
  path: z.string().describe("Folder path + document title, e.g. 'Courses/CS101/Todo'."),
  line: z.number().describe("1-based line of the task (pass with rawLine to edit it)."),
  rawLine: z.string().describe("The exact source line (pass with line to edit it)."),
  ordinal: z.number(),
  parentOrdinal: z.number().nullable().describe("Ordinal of the parent task for a subtask."),
  status: statusSchema,
  text: z.string(),
  note: z.string().nullable(),
  heading: z.string().nullable().describe("Nearest heading above the task."),
  dueDay: z.string().nullable(),
  dueTime: z.string().nullable(),
  doneDay: z.string().nullable(),
});

const taskRefInput = {
  line: z
    .number()
    .int()
    .min(1)
    .describe("The task's 1-based line, from listTasks/listDocumentTasks."),
  rawLine: z
    .string()
    .describe("The task's rawLine, exactly as listed. The edit is refused if the line changed; list again and retry."),
};

const listTasksInputSchema = z.object({
  status: z
    .array(statusSchema)
    .min(1)
    .default(["open", "in_progress"])
    .describe("Statuses to include (default open and in_progress)."),
  due: z
    .enum(["any", "overdue", "today", "next_7_days", "dated", "undated"])
    .default("any")
    .describe(
      "Due window relative to `today`: overdue (before today), today, next_7_days (today through 7 days on, including overdue), dated, undated, or any.",
    ),
  dueFrom: dayKeySchema.optional().describe("Explicit inclusive start of the due range."),
  dueThrough: dayKeySchema.optional().describe("Explicit inclusive end of the due range."),
  folder: z
    .string()
    .min(1)
    .optional()
    .describe("Only tasks in documents under this folder, by id or path (e.g. 'Courses/CS101')."),
  recursive: z
    .boolean()
    .default(true)
    .describe("With `folder`: include subfolders (default true)."),
  documentId: z.string().uuid().optional().describe("Only tasks in this document."),
  text: z.string().optional().describe("Only tasks whose text contains this (case-insensitive)."),
  today: todayInput,
  limit: z.number().int().min(1).max(500).default(100).describe("Maximum tasks (default 100)."),
});

const listTasksOutputSchema = z.object({
  today: z.string(),
  total: z.number().describe("How many tasks matched; more than `tasks.length` when limited."),
  tasks: z.array(taskSchema),
});

const listDocumentTasksInputSchema = z.object({
  status: z
    .array(statusSchema)
    .min(1)
    .optional()
    .describe("Statuses to include (default all)."),
});

const tasksOutputSchema = z.object({ tasks: z.array(taskSchema) });
const taskOutputSchema = z.object({ task: taskSchema });

const setTaskStatusInputSchema = z.object({
  ...taskRefInput,
  status: statusSchema.describe("done stamps :done[today]; any other status clears it."),
  today: todayInput,
});

const setTaskDueInputSchema = z.object({
  ...taskRefInput,
  due: dayKeySchema.nullable().describe("New due day (YYYY-MM-DD), or null to clear the due date."),
  time: timeSchema.optional().describe("Optional due time, HH:MM (24-hour)."),
});

const addTaskInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(500)
    .describe("The task text, one line of Markdown (no checkbox needed)."),
  due: dayKeySchema.optional().describe("Optional due day (YYYY-MM-DD)."),
  time: timeSchema.optional().describe("Optional due time, HH:MM (24-hour); needs `due`."),
  heading: z
    .string()
    .optional()
    .describe("Add at the end of this heading's section (text or slug); default is the end of the document."),
});

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Turns a named window into inclusive due bounds and a dated/undated filter. */
function dueWindow(
  due: z.infer<typeof listTasksInputSchema>["due"],
  today: string,
): { dueFrom?: string; dueThrough?: string; dated?: "dated" | "undated" } {
  switch (due) {
    case "overdue":
      return { dueThrough: addDaysToDayKey(today, -1) };
    case "today":
      return { dueFrom: today, dueThrough: today };
    case "next_7_days":
      return { dueThrough: addDaysToDayKey(today, 7) };
    case "dated":
      return { dated: "dated" };
    case "undated":
      return { dated: "undated" };
    default:
      return {};
  }
}

export default defineServer(manifest, {
  actions: [
    {
      id: "vault.tasks.listTasks",
      title: "List tasks",
      description:
        "List Markdown task lines (- [ ] …) across every document you own, soonest due first, each with its document's folder path so tasks in different folders (e.g. two 'Todo' notes in different course folders) are told apart. Filter by status, due window, folder (with subfolders), document, and text. Use the returned line + rawLine with setTaskStatus/setTaskDue. Documents shared with you are not included here; use listDocumentTasks on one.",
      scope: "workspace",
      mutates: false,
      permissions: ["document:read"],
      input: listTasksInputSchema,
      output: listTasksOutputSchema,
      async handler(input, context) {
        const tasksApi = context.workspace?.tasks;
        if (!tasksApi) throw new Error("This action requires read access.");

        const parsed = input as z.infer<typeof listTasksInputSchema>;
        const today = parsed.today ?? todayDayKey();
        const window = dueWindow(parsed.due, today);
        const { tasks, total } = await tasksApi.list({
          statuses: parsed.status,
          dueFrom: parsed.dueFrom ?? window.dueFrom,
          dueThrough: parsed.dueThrough ?? window.dueThrough,
          dated: window.dated ?? "any",
          folder: parsed.folder,
          recursive: parsed.recursive,
          documentId: parsed.documentId,
          text: parsed.text,
          limit: parsed.limit,
        });

        return {
          data: { today, total, tasks },
          message:
            total > tasks.length
              ? `${plural(total, "task")} matched; showing the first ${tasks.length}.`
              : `${plural(total, "task")} found.`,
        };
      },
    },
    {
      id: "vault.tasks.listDocumentTasks",
      title: "List a document's tasks",
      description:
        "List the Markdown task lines in one document — including subtasks, notes, and the heading each sits under — read from its current text. Works for documents shared with you as well as your own.",
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      input: listDocumentTasksInputSchema,
      output: tasksOutputSchema,
      async handler(input, context) {
        const tasksApi = context.document?.tasks;
        if (!tasksApi) throw new Error("This action requires a document.");

        const { status } = input as z.infer<typeof listDocumentTasksInputSchema>;
        const wanted = status ? new Set(status) : null;
        const tasks = (await tasksApi.list()).filter(
          (task) => !wanted || wanted.has(task.status),
        );

        return { data: { tasks }, message: `${plural(tasks.length, "task")}.` };
      },
    },
    {
      id: "vault.tasks.setTaskStatus",
      title: "Set a task's status",
      description:
        "Mark a task open, in progress, done, or cancelled. Completing it stamps :done[today]; reopening clears that. Only the task's own line changes.",
      scope: "document",
      mutates: true,
      permissions: ["document:read", "document:write"],
      input: setTaskStatusInputSchema,
      output: taskOutputSchema,
      async handler(input, context) {
        const setStatus = context.document?.tasks?.setStatus;
        if (!setStatus) throw new Error("This action requires edit access.");

        const { line, rawLine, status, today } = input as z.infer<
          typeof setTaskStatusInputSchema
        >;
        const task = await setStatus({ line, rawLine }, status, {
          today: today ?? todayDayKey(),
        });

        return { data: { task }, message: `Task is now ${status.replace("_", " ")}.` };
      },
    },
    {
      id: "vault.tasks.setTaskDue",
      title: "Set a task's due date",
      description:
        "Set, change, or clear (due: null) a task's due date and optional time, written as :due[YYYY-MM-DD HH:MM] on the task's line.",
      scope: "document",
      mutates: true,
      permissions: ["document:read", "document:write"],
      input: setTaskDueInputSchema,
      output: taskOutputSchema,
      async handler(input, context) {
        const setDue = context.document?.tasks?.setDue;
        if (!setDue) throw new Error("This action requires edit access.");

        const { line, rawLine, due, time } = input as z.infer<typeof setTaskDueInputSchema>;
        const task = await setDue({ line, rawLine }, due ? { day: due, time: time ?? null } : null);

        return {
          data: { task },
          message: due ? `Due ${due}${time ? ` ${time}` : ""}.` : "Due date cleared.",
        };
      },
    },
    {
      id: "vault.tasks.addTask",
      title: "Add a task",
      description:
        "Add an open task line to a document, at the end of the document or of a heading's section (joining an existing list there), with an optional due date and time.",
      scope: "document",
      mutates: true,
      permissions: ["document:read", "document:write"],
      input: addTaskInputSchema,
      output: taskOutputSchema,
      async handler(input, context) {
        const add = context.document?.tasks?.add;
        if (!add) throw new Error("This action requires edit access.");

        const { text, due, time, heading } = input as z.infer<typeof addTaskInputSchema>;

        if (time && !due) {
          throw new Error("A due time needs a due day.");
        }

        const task = await add({
          text,
          due: due ? { day: due, time: time ?? null } : null,
          heading,
        });

        return { data: { task }, message: `Added on line ${task.line}.` };
      },
    },
  ],
});
