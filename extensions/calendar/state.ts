import { z } from "zod";

export const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
export const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const calendarEntrySchema = z.object({
  type: z.enum(["task", "event"]),
  day: z.string().regex(dayKeyPattern),
  text: z.string().max(500).default(""),
  /** Tasks only: completion state. */
  done: z.boolean().optional(),
  /** Events only: optional `HH:MM` start time used to sort within a day. */
  time: z.string().regex(timePattern).optional(),
  note: z.string().max(2000).optional(),
  /** Manual ordering within a day cell. */
  order: z.number().default(0),
});

export const calendarStateSchema = z.object({
  entries: z.record(z.string(), calendarEntrySchema).default({}),
  /** Persisted full-bleed breakout toggle for this calendar block. */
  expanded: z.boolean().default(false),
});

export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
export type CalendarState = z.infer<typeof calendarStateSchema>;
