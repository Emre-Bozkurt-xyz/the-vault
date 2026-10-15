import { z } from "zod";

import { isValidDayKey } from "@/lib/tasks/dates";
import { normalizeTaskText } from "@/lib/tasks/edit";
import { TASK_PRIORITIES, TASK_TIME_PATTERN } from "@/lib/tasks/parse";
import { parseRecurrence } from "@/lib/tasks/recurrence";

/**
 * Input validation for task changes sent by the workspace task surfaces.
 *
 * Kept out of `server/tasks.ts` ("use server" modules may only export async
 * functions) so it can be unit-tested. Zod 4 builds a discriminated union's
 * lookup lazily, so a duplicated variant does not fail at import: it throws on
 * the first parse, and every workspace task write failed that way
 * from 2026-10-06 to 2026-10-15. `change-schema.test.ts` parses every variant.
 */
export const taskDayKeySchema = z.string().refine(isValidDayKey, "Must be a real YYYY-MM-DD date.");

export const taskChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: z.enum(["open", "in_progress", "done", "cancelled"]),
  }),
  z.object({
    type: z.literal("due"),
    day: taskDayKeySchema.nullable(),
    time: z.string().regex(TASK_TIME_PATTERN).nullable().optional(),
  }),
  z.object({ type: z.literal("priority"), priority: z.enum(TASK_PRIORITIES).nullable() }),
  z.object({
    type: z.literal("repeat"),
    repeat: z
      .string()
      .max(40)
      .refine((value) => Boolean(parseRecurrence(value)))
      .nullable(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().max(2_000).refine((value) => normalizeTaskText(value) !== null, "Type the task first."),
  }),
]);

/** A task as the client last saw it: line + exact text (row ids are not stable). */
export const taskLocatorSchema = z.object({
  today: taskDayKeySchema,
  documentId: z.string().uuid(),
  line: z.number().int().min(0),
  rawLine: z.string().max(20_000),
});

export const updateTaskInputSchema = taskLocatorSchema.extend({ change: taskChangeSchema });

const locatorSchema = taskLocatorSchema.omit({ today: true });

/**
 * One workspace operation over one or more tasks (`runTaskOperationAction`):
 * a field change, deleting them, or moving them to another document. Every
 * task surface writes through this, so bulk and single edits share one path.
 */
export const taskOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("change"), change: taskChangeSchema }),
  z.object({ kind: z.literal("delete") }),
  z.object({ kind: z.literal("move"), targetDocumentId: z.string().uuid() }),
]);

/** Enough for a sizeable bulk selection; each document is still one write. */
export const MAX_TASKS_PER_OPERATION = 200;

export const taskOperationInputSchema = z.object({
  today: taskDayKeySchema,
  items: z.array(locatorSchema).min(1).max(MAX_TASKS_PER_OPERATION),
  operation: taskOperationSchema,
});

const blockSchema = z.object({
  documentId: z.string().uuid(),
  lineIndex: z.number().int().min(0),
  block: z.string().min(1).max(200_000),
});

/** What Undo needs: blocks to put back, and blocks a move appended to take out. */
export const taskUndoSchema = z.object({
  removed: z.array(blockSchema).max(MAX_TASKS_PER_OPERATION),
  appended: z.array(blockSchema).max(MAX_TASKS_PER_OPERATION),
});
