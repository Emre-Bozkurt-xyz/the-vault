import "server-only";

import { z } from "zod";

import { defineServer } from "@/lib/extension-api/server";
import {
  calendarStateKey,
  formatCalendarFence,
  generateCalendarId,
  isValidDayKey,
} from "./lib/calendar";

import manifest from "./manifest";
import {
  calendarStateSchema,
  dayKeyPattern,
  timePattern,
  type CalendarEntry,
} from "./state";

/**
 * A `YYYY-MM-DD` day key that must also be a REAL calendar date — the regex alone
 * accepts `2026-13-99`. Used for agent action inputs; the stored entry schema
 * stays regex-only so reading existing (possibly imperfect) data never throws.
 */
const dayKeySchema = z
  .string()
  .regex(dayKeyPattern)
  .refine(isValidDayKey, "Must be a real calendar date (YYYY-MM-DD).");

/**
 * The instance handle for a calendar block. A document can hold several
 * calendars; each persists under the state key `calendar:<calendarId>`, matching
 * the id embedded in the in-document live block.
 */
const calendarIdInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i)
  .describe(
    "Calendar instance id (the <id> in its `calendar:<id>` state key).",
  );

const listEntriesInputSchema = z.object({
  calendarId: calendarIdInputSchema
    .optional()
    .describe(
      "A specific calendar to read. Omit to list all calendars in the document with their entry counts.",
    ),
});

const addEntryInputSchema = z.object({
  calendarId: calendarIdInputSchema,
  type: z
    .enum(["task", "event"])
    .default("task")
    .describe("'task' (completable) or 'event' (time-anchored reminder)."),
  day: dayKeySchema.describe("The day this entry belongs to, as YYYY-MM-DD."),
  text: z.string().max(500).default("").describe("The entry's label."),
  time: z
    .string()
    .regex(timePattern)
    .optional()
    .describe("Events only: optional HH:MM start time."),
  note: z.string().max(2000).optional().describe("Optional longer note."),
});

const addEntryOutputSchema = z.object({
  entryId: z.string().describe("Id of the created entry."),
});

const setEntryDoneInputSchema = z.object({
  calendarId: calendarIdInputSchema,
  entryId: z.string().min(1).describe("The task entry id (from listEntries)."),
  done: z
    .boolean()
    .default(true)
    .describe("Mark the task done (true) or reopen it (false)."),
});

const setEntryDoneOutputSchema = z.object({
  entryId: z.string(),
  done: z.boolean(),
});

const insertCalendarInputSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe(
      "Place the calendar within this heading's section (matched by text or slug). Omit to append at the document end.",
    ),
  position: z
    .enum(["section_start", "section_end"])
    .default("section_end")
    .describe("Where within the heading's section to place it."),
});

const insertCalendarOutputSchema = z.object({
  calendarId: z
    .string()
    .describe("Id of the new calendar; use it with addEntry/listEntries."),
});

const listUpcomingTasksInputSchema = z.object({
  from: dayKeySchema
    .optional()
    .describe("Only include tasks on/after this day (YYYY-MM-DD)."),
  to: dayKeySchema
    .optional()
    .describe("Only include tasks on/before this day (YYYY-MM-DD)."),
  includeDone: z
    .boolean()
    .default(false)
    .describe("Include completed tasks (default false)."),
});

const upcomingTaskSchema = z.object({
  source: z.enum(["calendar", "markdown"]),
  documentId: z.string(),
  documentTitle: z.string(),
  calendarId: z.string().optional(),
  entryId: z.string().optional(),
  ordinal: z.number().optional(),
  day: z.string(),
  text: z.string(),
  done: z.boolean(),
});

const listUpcomingTasksOutputSchema = z.object({
  tasks: z.array(upcomingTaskSchema),
});

export default defineServer(manifest, {
  state: [{ version: 1, schema: calendarStateSchema }],
  loadWorkspaceAgendaEvents({ rows, from, to }) {
    const events = [];
    for (const row of rows) {
      if (!row.stateKey.startsWith("calendar:")) continue;
      const parsed = calendarStateSchema.safeParse(row.state);
      if (!parsed.success) continue;
      for (const [entryId, entry] of Object.entries(parsed.data.entries)) {
        if (entry.type !== "event" || entry.day < from || entry.day > to) continue;
        events.push({
          id: `${row.documentId}:${row.stateKey}:${entryId}`,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          day: entry.day,
          time: entry.time ?? null,
          text: entry.text,
        });
      }
    }
    return events;
  },
  actions: [
    {
      id: "vault.calendar.listEntries",
      title: "List calendar entries",
      description:
        "Read a document's calendar data. With a calendarId, returns that calendar's tasks and events; without one, lists every calendar in the document and how many entries each has.",
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      input: listEntriesInputSchema,
      async handler(input, context) {
        const document = context.document;
        if (!document) {
          throw new Error("This action requires a document.");
        }

        const { calendarId } = input as z.infer<typeof listEntriesInputSchema>;

        if (calendarId) {
          const raw = await document.state.get(calendarStateKey(calendarId));
          if (!raw) {
            return {
              message: `No calendar "${calendarId}" exists in this document.`,
              data: { calendarId, entries: [] },
            };
          }
          const state = calendarStateSchema.parse(raw);
          const entries = Object.entries(state.entries)
            .map(([id, entry]) => ({ id, ...entry }))
            .sort(
              (a, b) =>
                a.day.localeCompare(b.day) ||
                (a.time ?? "").localeCompare(b.time ?? "") ||
                a.order - b.order,
            );
          return {
            data: { calendarId, entries },
            message: `Calendar "${calendarId}" has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`,
          };
        }

        const calendars = (await document.state.list())
          .filter((row) => row.stateKey.startsWith("calendar:"))
          .map((row) => {
            const parsed = calendarStateSchema.safeParse(row.state);
            return {
              calendarId: row.stateKey.slice("calendar:".length),
              entryCount: parsed.success
                ? Object.keys(parsed.data.entries).length
                : 0,
            };
          });
        return {
          data: { calendars },
          message: `This document has ${calendars.length} calendar${calendars.length === 1 ? "" : "s"}.`,
        };
      },
    },
    {
      id: "vault.calendar.addEntry",
      title: "Add a calendar entry",
      description:
        "Add a task or event to an existing calendar in a document, on a given day. Use listEntries first to find the calendarId.",
      scope: "document",
      mutates: true,
      permissions: ["document:write-extension-state"],
      input: addEntryInputSchema,
      output: addEntryOutputSchema,
      async handler(input, context) {
        const document = context.document;
        if (!document) {
          throw new Error("This action requires a document.");
        }

        const args = input as z.infer<typeof addEntryInputSchema>;
        const stateKey = calendarStateKey(args.calendarId);

        const existing = (await document.state.list()).find(
          (row) => row.stateKey === stateKey,
        );
        const current = existing
          ? calendarStateSchema.parse(existing.state)
          : calendarStateSchema.parse({});

        const id = crypto.randomUUID();
        const sameDayCount = Object.values(current.entries).filter(
          (entry) => entry.day === args.day,
        ).length;

        const entry: CalendarEntry = {
          type: args.type,
          day: args.day,
          text: args.text,
          order: sameDayCount,
          ...(args.type === "task" ? { done: false } : {}),
          ...(args.time ? { time: args.time } : {}),
          ...(args.note ? { note: args.note } : {}),
        };

        const next = calendarStateSchema.parse({
          ...current,
          entries: { ...current.entries, [id]: entry },
        });

        await document.state.set(next, {
          stateKey,
          version: 1,
          visibility: existing?.visibility ?? "private",
        });

        return {
          data: { entryId: id },
          message: `Added ${args.type} "${args.text}" to ${args.day} in calendar "${args.calendarId}".`,
        };
      },
    },
    {
      id: "vault.calendar.setEntryDone",
      title: "Complete or reopen a calendar task",
      description:
        "Mark a calendar task done or not-done. Events can't be completed. Use listEntries to find the entryId.",
      scope: "document",
      mutates: true,
      permissions: ["document:write-extension-state"],
      input: setEntryDoneInputSchema,
      output: setEntryDoneOutputSchema,
      async handler(input, context) {
        const document = context.document;
        if (!document) {
          throw new Error("This action requires a document.");
        }

        const args = input as z.infer<typeof setEntryDoneInputSchema>;
        const stateKey = calendarStateKey(args.calendarId);
        const existing = (await document.state.list()).find(
          (row) => row.stateKey === stateKey,
        );
        if (!existing) {
          throw new Error(
            `No calendar "${args.calendarId}" exists in this document.`,
          );
        }

        const current = calendarStateSchema.parse(existing.state);
        const entry = current.entries[args.entryId];
        if (!entry) {
          throw new Error(
            `No entry "${args.entryId}" in calendar "${args.calendarId}".`,
          );
        }
        if (entry.type !== "task") {
          throw new Error("Only tasks can be completed, not events.");
        }

        const next = calendarStateSchema.parse({
          ...current,
          entries: {
            ...current.entries,
            [args.entryId]: { ...entry, done: args.done },
          },
        });
        await document.state.set(next, {
          stateKey,
          version: 1,
          visibility: existing.visibility,
        });

        return {
          data: { entryId: args.entryId, done: args.done },
          message: `Marked task ${args.done ? "done" : "not done"}.`,
        };
      },
    },
    {
      id: "vault.calendar.insertCalendar",
      title: "Insert a calendar",
      description:
        "Create a new, empty month calendar in a document by inserting its block into the markdown. Returns the new calendarId to use with addEntry. Appends at the document end, or into a heading's section if given.",
      scope: "document",
      mutates: true,
      permissions: ["document:write"],
      input: insertCalendarInputSchema,
      output: insertCalendarOutputSchema,
      async handler(input, context) {
        const markdown = context.document?.markdown;
        if (!markdown?.append || !markdown.insertAtHeading) {
          throw new Error("This action requires document write access.");
        }

        const { heading, position } = input as z.infer<
          typeof insertCalendarInputSchema
        >;
        const calendarId = generateCalendarId();
        const fence = formatCalendarFence(calendarId);

        if (heading) {
          const { inserted } = await markdown.insertAtHeading(
            heading,
            fence,
            position,
          );
          if (!inserted) {
            throw new Error(`No heading matching "${heading}" was found.`);
          }
        } else {
          await markdown.append(fence);
        }

        return {
          data: { calendarId },
          message: `Inserted a calendar (id "${calendarId}").`,
        };
      },
    },
    {
      id: "vault.calendar.listUpcomingTasks",
      title: "List upcoming tasks",
      description:
        "Across your owned documents, list calendar and Markdown tasks — optionally within a day range and excluding completed ones. Useful for a daily digest of what's due.",
      scope: "workspace",
      mutates: false,
      permissions: ["document:read"],
      input: listUpcomingTasksInputSchema,
      output: listUpcomingTasksOutputSchema,
      async handler(input, context) {
        const workspaceState = context.workspace?.state;
        if (!workspaceState) {
          throw new Error("This action requires read access.");
        }

        const { from, to, includeDone } = input as z.infer<
          typeof listUpcomingTasksInputSchema
        >;

        const rows = await workspaceState.listAcrossDocuments();
        const tasks: Array<z.infer<typeof upcomingTaskSchema>> = [];

        for (const row of rows) {
          if (!row.stateKey.startsWith("calendar:")) continue;
          const calendarId = row.stateKey.slice("calendar:".length);
          const parsed = calendarStateSchema.safeParse(row.state);
          if (!parsed.success) continue;

          for (const [entryId, entry] of Object.entries(parsed.data.entries)) {
            if (entry.type !== "task") continue;
            const done = entry.done ?? false;
            if (done && !includeDone) continue;
            if (from && entry.day < from) continue;
            if (to && entry.day > to) continue;

            tasks.push({
              source: "calendar",
              documentId: row.documentId,
              documentTitle: row.documentTitle,
              calendarId,
              entryId,
              day: entry.day,
              text: entry.text,
              done,
            });
          }
        }

        if (context.tasks) {
          const markdownTasks = await context.tasks.list({ from, to, includeDone, limit: 500 });
          for (const task of markdownTasks) {
            if (!task.dueDay) continue;
            tasks.push({
              source: "markdown", documentId: task.documentId,
              documentTitle: task.documentTitle, ordinal: task.ordinal,
              day: task.dueDay, text: task.text, done: task.status === "done",
            });
          }
        }

        tasks.sort(
          (a, b) => a.day.localeCompare(b.day) || a.text.localeCompare(b.text),
        );

        return {
          data: { tasks },
          message: `${tasks.length} task${tasks.length === 1 ? "" : "s"} found.`,
        };
      },
    },
  ],
});
