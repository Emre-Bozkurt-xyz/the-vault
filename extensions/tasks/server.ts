import "server-only";

import { z } from "zod";
import { defineServer, parseRecurrence } from "@/lib/extension-api/server";
import manifest from "./manifest";

const day = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() + 1 === +match[2] && date.getUTCDate() === +match[3];
}, "Must be a real YYYY-MM-DD date.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const taskRef = { documentId: z.string().uuid(), ordinal: z.number().int().min(0), today: day };

export default defineServer(manifest, {
  actions: [
    {
      id: "vault.tasks.listTasks", title: "List Markdown tasks",
      description: "List indexed tasks in documents you own. Each task carries its document's folderPath and path (e.g. 'Courses/CS101/Todo') and its heading, so same-titled documents in different folders stay distinct. Filter by folder (id or path, subfolders included unless recursive is false) and task text. Dates use YYYY-MM-DD; omit the range to include undated tasks.",
      scope: "workspace", mutates: false, permissions: ["document:read"],
      input: z.object({
        from: day.optional(), to: day.optional(), includeDone: z.boolean().default(false), limit: z.number().int().min(1).max(500).default(200),
        folder: z.string().min(1).optional().describe("Folder id or path, e.g. 'Courses/CS101'."),
        recursive: z.boolean().default(true).describe("With folder: include subfolders."),
        text: z.string().optional().describe("Only tasks whose text contains this (case-insensitive)."),
      }),
      async handler(input, context) {
        const tasks = context.tasks;
        if (!tasks) throw new Error("Task read access is required.");
        const rows = await tasks.list(input as {
          from?: string; to?: string; includeDone?: boolean; limit?: number;
          folder?: string; recursive?: boolean; text?: string;
        });
        return { data: { tasks: rows }, message: `${rows.length} task(s) found.` };
      },
    },
    {
      id: "vault.tasks.addTask", title: "Add a Markdown task",
      description: "Add a task to your Inbox, or to an owned document identified by documentId (preferred: titles can repeat across folders) or by its exact title. A natural-language date at the end is supported.",
      scope: "workspace", mutates: true, permissions: ["document:read", "document:write"],
      input: z.object({
        text: z.string().trim().min(1).max(2000), today: day,
        documentId: z.string().uuid().optional().describe("Target document you own; takes precedence over documentTitle."),
        documentTitle: z.string().trim().min(1).max(255).optional(),
      }),
      async handler(input, context) {
        if (!context.tasks?.add) throw new Error("Task write access is required.");
        const task = await context.tasks.add(input as { text: string; today: string; documentId?: string; documentTitle?: string });
        return { data: task, message: "Task added." };
      },
    },
    {
      id: "vault.tasks.setTaskStatus", title: "Change a Markdown task's status",
      description: "Set the status of a task returned by listTasks, using its documentId and ordinal. The live line is checked before writing.",
      scope: "workspace", mutates: true, permissions: ["document:read", "document:write"],
      input: z.object({ ...taskRef, status: z.enum(["open", "in_progress", "done", "cancelled"]) }),
      async handler(input, context) {
        if (!context.tasks?.change) throw new Error("Task write access is required.");
        const args = input as { documentId: string; ordinal: number; today: string; status: "open" | "in_progress" | "done" | "cancelled" };
        await context.tasks.change({ ...args, change: { type: "status", status: args.status } });
        return { message: "Task status updated." };
      },
    },
    {
      id: "vault.tasks.setTaskDue", title: "Schedule a Markdown task",
      description: "Set or clear the due date of a task returned by listTasks, using its documentId and ordinal.",
      scope: "workspace", mutates: true, permissions: ["document:read", "document:write"],
      input: z.object({ ...taskRef, day: day.nullable(), time: time.nullable().optional() }),
      async handler(input, context) {
        if (!context.tasks?.change) throw new Error("Task write access is required.");
        const args = input as { documentId: string; ordinal: number; today: string; day: string | null; time?: string | null };
        await context.tasks.change({ ...args, change: { type: "due", day: args.day, time: args.time } });
        return { message: "Task due date updated." };
      },
    },
    {
      id: "vault.tasks.setTaskPriority", title: "Prioritize a Markdown task",
      description: "Set high, medium, or low priority, or clear it with null, for a task returned by listTasks.",
      scope: "workspace", mutates: true, permissions: ["document:read", "document:write"],
      input: z.object({ ...taskRef, priority: z.enum(["high", "medium", "low"]).nullable() }),
      async handler(input, context) {
        if (!context.tasks?.change) throw new Error("Task write access is required.");
        const args = input as { documentId: string; ordinal: number; today: string; priority: "high" | "medium" | "low" | null };
        await context.tasks.change({ ...args, change: { type: "priority", priority: args.priority } });
        return { message: "Task priority updated." };
      },
    },
    {
      id: "vault.tasks.setTaskRepeat", title: "Set task recurrence",
      description: "Set daily, weekly, monthly, yearly, every N days/weeks/months/years (fixed schedule), or after N days/weeks/months/years (from completion). Month/year anchors (on 31 or on 02-29) are retained automatically. Null clears recurrence.",
      scope: "workspace", mutates: true, permissions: ["document:read", "document:write"],
      input: z.object({ ...taskRef, repeat: z.string().max(40).refine((value) => Boolean(parseRecurrence(value))).nullable() }),
      async handler(input, context) {
        if (!context.tasks?.change) throw new Error("Task write access is required.");
        const args = input as { documentId: string; ordinal: number; today: string; repeat: string | null };
        await context.tasks.change({ ...args, change: { type: "repeat", repeat: args.repeat } });
        return { message: "Task recurrence updated." };
      },
    },
  ],
});
