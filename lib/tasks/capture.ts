/**
 * Quick capture (docs/24_TASKS_AND_AGENDA_PLAN.md §6.3): turns what was typed
 * after `/task` or into the panel's "Add task…" box into one task line.
 *
 * A date is only taken from the END of the text, and only when it is
 * unambiguous (strict parsing: "the cat sat" stays a sentence) — unless the
 * author marks it with `@`, which accepts everything the `@` menu does:
 *
 *   "send invoice friday"      → - [ ] send invoice :due[<next Friday>]
 *   "call Tom tomorrow at 9am"  → - [ ] call Tom :due[<tomorrow> 09:00]
 *   "pay rent @fri"             → - [ ] pay rent :due[<next Friday>]
 *   "call Tom"                  → - [ ] call Tom
 */

import { formatDueDirective, parseNaturalDate, type NaturalDate } from "@/lib/tasks/natural-date";
import { MAX_TASK_TEXT_LENGTH } from "@/lib/tasks/parse";

export type CapturedTask = { text: string; due: NaturalDate | null; line: string };

/** Words dropped before a trailing date: "pay rent by friday" → "pay rent". */
const connectives = new Set(["on", "by", "at", "due", "for"]);

/** Longest trailing phrase tried as a date ("next friday at 3pm" is 4 words). */
const maxDateWords = 5;

export function parseCapture(input: string, today: string): CapturedTask | null {
  let text = input
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Someone typing the Markdown out of habit.
    .replace(/^[-*+]\s+\[[ xX/-]\]\s*/, "");

  if (!text) return null;

  let due: NaturalDate | null = null;
  const words = text.split(" ");

  for (let count = Math.min(maxDateWords, words.length - 1); count >= 1 && !due; count -= 1) {
    const phrase = words.slice(words.length - count);
    const marked = phrase[0].startsWith("@");

    if (marked) phrase[0] = phrase[0].slice(1);

    const parsed = parseNaturalDate(phrase.join(" "), today, { strict: !marked });

    if (parsed) {
      let rest = words.slice(0, words.length - count);
      while (rest.length > 1 && connectives.has(rest[rest.length - 1].toLowerCase())) {
        rest = rest.slice(0, -1);
      }
      due = parsed;
      text = rest.join(" ");
    }
  }

  text = text.slice(0, MAX_TASK_TEXT_LENGTH).trim();
  if (!text) return null;

  return {
    text,
    due,
    line: `- [ ] ${text}${due ? ` ${formatDueDirective(due)}` : ""}`,
  };
}
