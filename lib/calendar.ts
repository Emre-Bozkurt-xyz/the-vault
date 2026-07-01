// Framework-free helpers for the calendar extension: the markdown anchor fence
// (`:::calendar{id=…}`) and timezone-naive day math. Day keys are always plain
// `YYYY-MM-DD` strings so a task never drifts to an adjacent cell across zones.

export type CalendarWeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

export type CalendarMonthCell = {
  /** `YYYY-MM-DD` day key. */
  dayKey: string;
  /** Day-of-month number (1-31). */
  day: number;
  /** False for leading/trailing cells that belong to an adjacent month. */
  inMonth: boolean;
  /** True when this cell is today's date in the viewer's local time. */
  isToday: boolean;
};

const calendarFencePattern = /^:::calendar(?:\{([^}\n]*)\})?\s*$/i;
const idTokenPattern = /\bid\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)/i;
const idValuePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Returns the parsed `{ id }` when `line` is a calendar anchor, else null. */
export function parseCalendarFence(line: string): { id: string | null } | null {
  const match = line.trim().match(calendarFencePattern);

  if (!match) {
    return null;
  }

  const rawAttributes = match[1] ?? "";
  const idMatch = rawAttributes.match(idTokenPattern);
  const rawId = (idMatch?.[2] ?? idMatch?.[3] ?? idMatch?.[1] ?? "").trim();
  const id = idValuePattern.test(rawId) ? rawId : null;

  return { id };
}

export function formatCalendarFence(id: string): string {
  return `:::calendar{id=${id}}`;
}

export type CalendarSegment =
  | { type: "markdown"; markdown: string }
  | { type: "calendar"; id: string | null };

/**
 * Splits markdown into runs of plain markdown interleaved with calendar anchors,
 * so read-only render surfaces (MarkdownDocument) can mount a calendar where the
 * `:::calendar{id=…}` fence sits in the document flow.
 */
export function splitCalendarSegments(markdown: string): CalendarSegment[] {
  const segments: CalendarSegment[] = [];
  const lines = markdown.split(/\r?\n/);
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", markdown: buffer.join("\n") });
      buffer = [];
    }
  };

  for (const line of lines) {
    const fence = parseCalendarFence(line);

    if (fence) {
      flush();
      segments.push({ type: "calendar", id: fence.id });
    } else {
      buffer.push(line);
    }
  }

  flush();
  return segments;
}

export function generateCalendarId(): string {
  const globalCrypto =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }

  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** State key under which a calendar block stores its entries. */
export function calendarStateKey(id: string): string {
  return `calendar:${id}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Builds a `YYYY-MM-DD` key from calendar parts (month is 1-12). */
export function toDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
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
  return toDayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export type CalendarMonth = { year: number; month: number }; // month 1-12

export function currentMonth(now: Date = new Date()): CalendarMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function addMonths(
  { year, month }: CalendarMonth,
  delta: number,
): CalendarMonth {
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

export function weekdayLabels(weekStartsOn: CalendarWeekStart): string[] {
  const base = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return weekStartsOn === 1 ? [...base.slice(1), base[0]] : base;
}

/**
 * Builds the 6-row month grid (leading/trailing days filled from adjacent
 * months) for `year`/`month` (month 1-12). Uses UTC parts internally so the
 * day keys never shift with the host timezone.
 */
export function getMonthMatrix(
  { year, month }: CalendarMonth,
  weekStartsOn: CalendarWeekStart = 0,
  todayKey: string = todayDayKey(),
): CalendarMonthCell[][] {
  // First day-of-week of the month, shifted by the configured week start.
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = (firstWeekday - weekStartsOn + 7) % 7;

  const cells: CalendarMonthCell[] = [];
  const start = new Date(Date.UTC(year, month - 1, 1 - leading));

  for (let i = 0; i < 42; i += 1) {
    const cellYear = start.getUTCFullYear();
    const cellMonth = start.getUTCMonth() + 1;
    const cellDay = start.getUTCDate();
    const dayKey = toDayKey(cellYear, cellMonth, cellDay);

    cells.push({
      dayKey,
      day: cellDay,
      inMonth: cellMonth === month && cellYear === year,
      isToday: dayKey === todayKey,
    });

    start.setUTCDate(start.getUTCDate() + 1);
  }

  const weeks: CalendarMonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return weeks;
}
