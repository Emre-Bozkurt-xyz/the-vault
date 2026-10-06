import { addDaysToDayKey, daysBetween, isValidDayKey } from "@/lib/tasks/dates";

export type TaskRecurrence = {
  interval: number;
  unit: "day" | "week" | "month" | "year";
  fromCompletion: boolean;
  anchor?: string;
};
const presets: Record<string, TaskRecurrence["unit"]> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

/** Strict, portable rules. Invalid rules remain visible and never spawn tasks. */
export function parseRecurrence(value: unknown): TaskRecurrence | null {
  if (typeof value !== "string") return null;
  const anchored = /^(.*?) on (\d{1,2}|\d{2}-\d{2})$/.exec(value);
  if (anchored) {
    const rule = parseRecurrence(anchored[1]);
    if (!rule || rule.fromCompletion || rule.anchor) return null;
    const anchor = anchored[2];
    if (
      rule.unit === "month" &&
      /^\d{1,2}$/.test(anchor) &&
      Number(anchor) >= 1 &&
      Number(anchor) <= 31
    )
      return { ...rule, anchor };
    if (
      rule.unit === "year" &&
      /^\d{2}-\d{2}$/.test(anchor) &&
      isValidDayKey(`2024-${anchor}`)
    )
      return { ...rule, anchor };
    return null;
  }
  const preset = Object.hasOwn(presets, value) ? presets[value] : undefined;
  if (preset) return { interval: 1, unit: preset, fromCompletion: false };
  const match = /^(every|after) ([1-9]\d{0,2}) (day|week|month|year)s?$/.exec(
    value,
  );
  if (!match || Number(match[2]) > 365) return null;
  return {
    interval: Number(match[2]),
    unit: match[3] as TaskRecurrence["unit"],
    fromCompletion: match[1] === "after",
  };
}

/** Clamp month/year increments to that month's last day; all arithmetic uses UTC. */
function advance(day: string, rule: TaskRecurrence, count: number): string {
  if (rule.unit === "day" || rule.unit === "week")
    return addDaysToDayKey(
      day,
      rule.interval * count * (rule.unit === "week" ? 7 : 1),
    );
  const [year, month, date] = day.split("-").map(Number);
  const [anchorMonth, anchorDate] =
    rule.unit === "year" && rule.anchor
      ? rule.anchor.split("-").map(Number)
      : [month, rule.anchor ? Number(rule.anchor) : date];
  const months = rule.interval * count * (rule.unit === "year" ? 12 : 1);
  const target = new Date(Date.UTC(year, anchorMonth - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDate, last));
  return target.toISOString().slice(0, 10);
}

/** Exactly one future occurrence, skipping missed slots on a fixed schedule. */
export function nextRecurringDay(
  value: string,
  due: string | null,
  today: string,
): string | null {
  const rule = parseRecurrence(value);
  if (!rule || !isValidDayKey(today) || (due !== null && !isValidDayKey(due)))
    return null;
  const base = rule.fromCompletion ? today : (due ?? today);
  let count = 1;
  if (!rule.fromCompletion && base <= today) {
    if (rule.unit === "day" || rule.unit === "week")
      count =
        Math.floor(
          daysBetween(base, today) /
            (rule.interval * (rule.unit === "week" ? 7 : 1)),
        ) + 1;
    else {
      const [by, bm] = base.split("-").map(Number);
      const [ty, tm] = today.split("-").map(Number);
      count = Math.max(
        1,
        Math.floor(
          ((ty - by) * 12 + tm - bm) /
            (rule.interval * (rule.unit === "year" ? 12 : 1)),
        ),
      );
    }
  }
  let next = advance(base, rule, count);
  if (next <= today) next = advance(base, rule, count + 1);
  return isValidDayKey(next) && next > today ? next : null;
}

/** Retain month-end/leap-day intent in portable source on the next occurrence. */
export function anchorRecurrence(value: string, due: string): string {
  const rule = parseRecurrence(value);
  if (!rule || rule.fromCompletion || rule.anchor || !isValidDayKey(due))
    return value;
  if (rule.unit === "month") return `${value} on ${Number(due.slice(8))}`;
  if (rule.unit === "year") return `${value} on ${due.slice(5)}`;
  return value;
}
