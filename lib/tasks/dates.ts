/**
 * Day-key arithmetic and labels for task due dates. Day keys are plain
 * `YYYY-MM-DD` strings (the `lib/calendar.ts` convention); every calculation
 * runs in UTC parts so a key never shifts with the host timezone. "Today" is
 * always supplied by the caller from the viewer's local clock, never read from
 * the server's.
 */

const weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthShort = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toUtcDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtcDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export function addDaysToDayKey(dayKey: string, days: number): string {
  const date = toUtcDate(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

/** The Monday after `dayKey` (a week ahead when `dayKey` is itself a Monday). */
export function nextWeekStart(dayKey: string): string {
  const weekday = toUtcDate(dayKey).getUTCDay();
  return addDaysToDayKey(dayKey, ((8 - weekday) % 7) || 7);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/**
 * A compact label relative to `today`: "Today", "Tomorrow", "Yesterday", a
 * weekday within the coming week, otherwise "Fri 2 Oct" (with the year when it
 * differs from today's).
 */
export function formatDueLabel(dayKey: string, today: string): string {
  const offset = daysBetween(today, dayKey);

  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";

  const date = toUtcDate(dayKey);
  const weekday = weekdayShort[date.getUTCDay()];

  if (offset > 1 && offset < 7) return weekday;

  const base = `${weekday} ${date.getUTCDate()} ${monthShort[date.getUTCMonth()]}`;
  return dayKey.slice(0, 4) === today.slice(0, 4)
    ? base
    : `${base} ${dayKey.slice(0, 4)}`;
}
