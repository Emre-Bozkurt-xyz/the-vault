/**
 * Day-key arithmetic and labels for task due dates. Day keys are plain
 * `YYYY-MM-DD` strings (the calendar extension's convention); every calculation
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

/**
 * Whether `value` is a real calendar date in `YYYY-MM-DD` form. The bare
 * `^\d{4}-\d{2}-\d{2}$` regex accepts impossible dates like `2026-13-99`; this
 * additionally rejects out-of-range months/days (and Feb 30 etc.).
 */
export function isValidDayKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Today's date in the viewer's local time as a `YYYY-MM-DD` key. */
export function todayDayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export type CalendarMonth = { year: number; month: number };

export function addMonths({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

const monthLabels = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatMonthLabel({ year, month }: CalendarMonth): string {
  return `${monthLabels[month - 1]} ${year}`;
}

/** Six-row Monday-start grid for the Tasks month view. */
export function getMonthMatrix(
  { year, month }: CalendarMonth,
  weekStartsOn: 0 | 1 = 0,
  todayKey: string = todayDayKey(),
): { dayKey: string; day: number; inMonth: boolean; isToday: boolean }[][] {
  const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() - weekStartsOn + 7) % 7;
  const date = new Date(Date.UTC(year, month - 1, 1 - leading));
  const cells = Array.from({ length: 42 }, () => {
    const dayKey = fromUtcDate(date);
    const cell = {
      dayKey,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() + 1 === month && date.getUTCFullYear() === year,
      isToday: dayKey === todayKey,
    };
    date.setUTCDate(date.getUTCDate() + 1);
    return cell;
  });
  return Array.from({ length: 6 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
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
