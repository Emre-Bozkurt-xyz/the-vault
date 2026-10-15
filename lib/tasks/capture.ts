/**
 * Quick capture (docs/24_TASKS_AND_AGENDA_PLAN.md §6.3): turns what was typed
 * after `/task` or into an "Add task…" box into one task line.
 *
 * Extras are only read from the END of the text, in any order, and anything
 * that does not parse stays in the task's words:
 *
 *   "send invoice friday"          → - [ ] send invoice :due[<next Friday>]
 *   "call Tom tomorrow at 9am"      → - [ ] call Tom :due[<tomorrow> 09:00]
 *   "pay rent @fri"                 → - [ ] pay rent :due[<next Friday>]
 *   "water plants every week !low"  → - [ ] water plants :priority[low] :repeat[weekly]
 *   "standup every monday"          → - [ ] standup :due[<next Monday>] :repeat[weekly]
 *   "draft intro #Thesis"           → - [ ] draft intro   (target: "Thesis")
 *
 * Dates are strict unless marked with `@` ("the cat sat" stays a sentence).
 * A `#Target` is only a request: the server resolves it to a document the
 * user owns, and keeps the text as written when none matches.
 */

import { formatDueDirective, parseNaturalDate, type NaturalDate } from "@/lib/tasks/natural-date";
import { MAX_TASK_TEXT_LENGTH, type TaskPriority } from "@/lib/tasks/parse";
import { parseRecurrence } from "@/lib/tasks/recurrence";

export type CapturedTask = {
  text: string;
  due: NaturalDate | null;
  priority: TaskPriority | null;
  repeat: string | null;
  /** A document title asked for with `#Title` or `#[[Title]]`; unresolved. */
  target: string | null;
  line: string;
};

/** Words dropped before a trailing date: "pay rent by friday" → "pay rent". */
const connectives = new Set(["on", "by", "at", "due", "for"]);

/** Longest trailing phrase tried as a date ("next friday at 3pm" is 4 words). */
const maxDateWords = 5;

const priorityTokens: Record<string, TaskPriority> = {
  "!high": "high",
  "!h": "high",
  "!medium": "medium",
  "!med": "medium",
  "!m": "medium",
  "!low": "low",
  "!l": "low",
};

const unitWords: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * A trailing `every …` phrase as a recurrence rule, plus the first due day it
 * implies ("every monday" → weekly from next Monday). Words consumed counted
 * from the end.
 */
function readRepeat(
  words: string[],
  today: string,
): { repeat: string; due: NaturalDate | null; count: number } | null {
  const lower = words.map((word) => word.toLowerCase());
  const at = lower.lastIndexOf("every");
  if (at < 1 || words.length - at > 3) return null;
  const rest = lower.slice(at + 1);
  const count = words.length - at;

  if (rest.length === 1) {
    if (unitWords[rest[0]]) return { repeat: unitWords[rest[0]], due: null, count };
    const weekday = weekdays.find((name) => name === rest[0] || name.slice(0, 3) === rest[0]);
    if (weekday) {
      const due = parseNaturalDate(weekday, today, { strict: true });
      return due ? { repeat: "weekly", due, count } : null;
    }
    return null;
  }

  if (rest.length === 2) {
    const interval = rest[0] === "other" ? "2" : rest[0];
    const unit = rest[1].replace(/s$/, "");
    const rule = `every ${interval} ${unit}${interval === "1" ? "" : "s"}`;
    if (interval === "1" && unitWords[unit]) return { repeat: unitWords[unit], due: null, count };
    return parseRecurrence(rule) ? { repeat: rule, due: null, count } : null;
  }

  return null;
}

/** A trailing `#Title` or `#[[Title with spaces]]`; words consumed from the end. */
function readTarget(words: string[]): { target: string; count: number } | null {
  const last = words[words.length - 1];
  if (/^#[^#\s[\]]+$/.test(last)) return { target: last.slice(1), count: 1 };

  if (!last.endsWith("]]")) return null;
  for (let start = words.length - 1; start >= 1; start -= 1) {
    if (words[start].startsWith("#[[")) {
      const target = words.slice(start).join(" ").slice(3, -2).trim();
      return target ? { target, count: words.length - start } : null;
    }
  }
  return null;
}

export function parseCapture(input: string, today: string): CapturedTask | null {
  let words = input
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Someone typing the Markdown out of habit.
    .replace(/^[-*+]\s+\[[ xX/-]\]\s*/, "")
    .split(" ")
    .filter(Boolean);

  let due: NaturalDate | null = null;
  let priority: TaskPriority | null = null;
  let repeat: string | null = null;
  let target: string | null = null;

  // Peel extras off the end until a pass finds none. At least one word always
  // stays: the whole text is never consumed as metadata.
  for (let changed = true; changed && words.length > 1; ) {
    changed = false;
    const last = words[words.length - 1].toLowerCase();

    if (!priority && priorityTokens[last]) {
      priority = priorityTokens[last];
      words = words.slice(0, -1);
      changed = true;
      continue;
    }

    const targetMatch: ReturnType<typeof readTarget> = target ? null : readTarget(words);
    if (targetMatch && targetMatch.count < words.length) {
      target = targetMatch.target;
      words = words.slice(0, -targetMatch.count);
      changed = true;
      continue;
    }

    const repeatMatch: ReturnType<typeof readRepeat> = repeat ? null : readRepeat(words, today);
    if (repeatMatch) {
      repeat = repeatMatch.repeat;
      due ??= repeatMatch.due;
      words = words.slice(0, -repeatMatch.count);
      changed = true;
      continue;
    }

    if (!due) {
      for (let count = Math.min(maxDateWords, words.length - 1); count >= 1; count -= 1) {
        const phrase = words.slice(words.length - count);
        const marked = phrase[0].startsWith("@");
        if (marked) phrase[0] = phrase[0].slice(1);

        const parsed = parseNaturalDate(phrase.join(" "), today, { strict: !marked });
        if (!parsed) continue;

        let rest = words.slice(0, words.length - count);
        while (rest.length > 1 && connectives.has(rest[rest.length - 1].toLowerCase())) {
          rest = rest.slice(0, -1);
        }
        due = parsed;
        words = rest;
        changed = true;
        break;
      }
    }
  }

  const text = words.join(" ").slice(0, MAX_TASK_TEXT_LENGTH).trim();
  if (!text) return null;

  return { text, due, priority, repeat, target, line: buildTaskLine({ text, due, priority, repeat }) };
}

/** The Markdown line for a captured task; fields in the order the editor writes them. */
export function buildTaskLine(task: {
  text: string;
  due: NaturalDate | null;
  priority: TaskPriority | null;
  repeat: string | null;
}): string {
  return [
    `- [ ] ${task.text}`,
    task.due ? formatDueDirective(task.due) : null,
    task.priority ? `:priority[${task.priority}]` : null,
    task.repeat ? `:repeat[${task.repeat}]` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Daily-note capture keeps an undated task in today's agenda. Explicit dates win. */
export function parseDailyCapture(input: string, today: string): CapturedTask | null {
  const captured = parseCapture(input, today);
  if (!captured || captured.due) return captured;
  const due = { day: today, time: null };
  return { ...captured, due, line: buildTaskLine({ ...captured, due }) };
}
