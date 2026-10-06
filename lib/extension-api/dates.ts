/**
 * Day-key helpers for extensions (`docs/23_EXTENSION_SDK_PLAN.md` §8): plain
 * `YYYY-MM-DD` strings, the convention task due dates and calendars share.
 * Core owns the arithmetic so every surface agrees on what a valid day is.
 */
export {
  addDaysToDayKey,
  daysBetween,
  isValidDayKey,
  todayDayKey,
} from "@/lib/tasks/dates";
