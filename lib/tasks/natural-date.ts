/**
 * The small date grammar behind the editor's `@` menu and quick capture
 * (docs/23_TASKS_AND_AGENDA_PLAN.md §7). Everything is relative to a supplied
 * `today` day key, never the host clock, and deliberately small: no numeric
 * `10/2` forms, which mean different days in different locales.
 *
 * Accepts: today, tomorrow/tmrw, weekday names (the next occurrence after
 * today), "next <weekday>" (a week after that), "next week" (the coming
 * Monday), "in N days|weeks", "oct 2" / "2 oct" / "october 2", ISO dates, and an
 * optional time ("3pm", "3:30pm", "15:00", "at 9am").
 */

import { isValidDayKey } from "@/lib/calendar";
import { addDaysToDayKey, formatDueLabel, nextWeekStart } from "@/lib/tasks/dates";

export type NaturalDate = { day: string; time: string | null };

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function weekdayOf(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Index of a weekday named by `word` (full name or a prefix of 2+ letters). */
function weekdayIndex(word: string): number {
  if (word.length < 2) return -1;
  return weekdays.findIndex((name) => name.startsWith(word));
}

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return months.findIndex((name) => name.startsWith(word));
}

/** The first `weekday` strictly after `today`. */
function nextWeekday(today: string, weekday: number): string {
  const offset = (weekday - weekdayOf(today) + 7) % 7 || 7;
  return addDaysToDayKey(today, offset);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** "3pm", "3:30pm", "15:00", "9am" → "HH:MM"; null when it is not a time. */
function parseTime(text: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  // A bare number is a day of the month or a count, not a time.
  if (!meridiem && !match[2]) return null;
  if (minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

/** A month and day, rolled into next year when it has already passed. */
function monthDay(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${pad(month + 1)}-${pad(day)}`;
  if (!isValidDayKey(candidate)) return null;
  if (candidate >= today) return candidate;
  const nextYear = `${year + 1}-${pad(month + 1)}-${pad(day)}`;
  return isValidDayKey(nextYear) ? nextYear : null;
}

function parseDay(text: string, today: string): string | null {
  if (text === "today" || text === "tod") return today;
  if (text === "tomorrow" || text === "tmrw" || text === "tom") return addDaysToDayKey(today, 1);
  if (text === "next week") return nextWeekStart(today);
  if (isValidDayKey(text)) return text;

  const inMatch = /^in (\d{1,3}) ?(days?|d|weeks?|w)$/.exec(text);
  if (inMatch) {
    const count = Number(inMatch[1]);
    return addDaysToDayKey(today, inMatch[2].startsWith("w") ? count * 7 : count);
  }

  const nextMatch = /^next ([a-z]+)$/.exec(text);
  if (nextMatch) {
    const weekday = weekdayIndex(nextMatch[1]);
    return weekday === -1 ? null : addDaysToDayKey(nextWeekday(today, weekday), 7);
  }

  const weekday = weekdayIndex(text);
  if (weekday !== -1) return nextWeekday(today, weekday);

  const monthFirst = /^([a-z]+) (\d{1,2})$/.exec(text);
  if (monthFirst && monthIndex(monthFirst[1]) !== -1) {
    return monthDay(today, monthIndex(monthFirst[1]), Number(monthFirst[2]));
  }

  const dayFirst = /^(\d{1,2}) ([a-z]+)$/.exec(text);
  if (dayFirst && monthIndex(dayFirst[2]) !== -1) {
    return monthDay(today, monthIndex(dayFirst[2]), Number(dayFirst[1]));
  }

  return null;
}

/** Parses a whole phrase, or returns null. */
export function parseNaturalDate(input: string, today: string): NaturalDate | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;

  const day = parseDay(text, today);
  if (day) return { day, time: null };

  // Try splitting a trailing time off: "fri 3pm", "tomorrow at 9:30am".
  const timed = /^(.*?)(?: at)? (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/.exec(text);
  if (timed) {
    const time = parseTime(timed[2]);
    const timedDay = time ? parseDay(timed[1], today) : null;
    if (time && timedDay) return { day: timedDay, time };
  }

  // A time alone means today.
  const time = parseTime(text.replace(/^at /, ""));
  return time ? { day: today, time } : null;
}

export type DateSuggestion = NaturalDate & {
  /** What the menu shows, e.g. "Tomorrow". */
  label: string;
  /** Secondary text, e.g. "Thu 1 Oct". */
  detail: string;
};

function suggestion(label: string, date: NaturalDate, today: string): DateSuggestion {
  const detail = formatDueLabel(date.day, today);
  return {
    ...date,
    label,
    detail: (detail === label ? date.day : detail) + (date.time ? ` ${date.time}` : ""),
  };
}

/**
 * Menu entries for what the author has typed after `@`: the exact parse first
 * (when there is one), then fixed shortcuts whose names start with the query.
 */
export function suggestDates(query: string, today: string): DateSuggestion[] {
  const text = query.trim().toLowerCase().replace(/\s+/g, " ");
  const fixed: Array<[string, NaturalDate]> = [
    ["Today", { day: today, time: null }],
    ["Tomorrow", { day: addDaysToDayKey(today, 1), time: null }],
    ["Next week", { day: nextWeekStart(today), time: null }],
    ...weekdays.map((name, index): [string, NaturalDate] => [
      name[0].toUpperCase() + name.slice(1),
      { day: nextWeekday(today, index), time: null },
    ]),
  ];

  const results: DateSuggestion[] = [];
  const seen = new Set<string>();
  const add = (entry: DateSuggestion) => {
    const key = `${entry.day} ${entry.time ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(entry);
    }
  };

  const exact = parseNaturalDate(text, today);
  if (exact) {
    // "fr" parses to Friday: show it under the shortcut's name, not "fr".
    const named = fixed.find(
      ([label, date]) =>
        label.toLowerCase() === text ||
        (!exact.time && date.day === exact.day && label.toLowerCase().startsWith(text)),
    );
    add(suggestion(named ? named[0] : query.trim(), exact, today));
  }

  for (const [label, date] of fixed) {
    if (!text || label.toLowerCase().startsWith(text)) add(suggestion(label, date, today));
  }

  return results.slice(0, 8);
}

/** The directive text for a parsed date. */
export function formatDueDirective(date: NaturalDate): string {
  return `:due[${date.day}${date.time ? ` ${date.time}` : ""}]`;
}
