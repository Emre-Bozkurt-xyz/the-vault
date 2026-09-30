import { describe, expect, it } from "vitest";

import { formatDueDirective, parseNaturalDate, suggestDates } from "@/lib/tasks/natural-date";

const today = "2026-09-30"; // a Wednesday
const day = (input: string) => parseNaturalDate(input, today)?.day ?? null;

describe("parseNaturalDate", () => {
  it("reads relative words", () => {
    expect(day("today")).toBe("2026-09-30");
    expect(day("Tomorrow")).toBe("2026-10-01");
    expect(day("tmrw")).toBe("2026-10-01");
    expect(day("next week")).toBe("2026-10-05");
    expect(day("in 3 days")).toBe("2026-10-03");
    expect(day("in 2 weeks")).toBe("2026-10-14");
  });

  it("takes weekdays as the next occurrence after today", () => {
    expect(day("fri")).toBe("2026-10-02");
    expect(day("wednesday")).toBe("2026-10-07"); // today is Wednesday
    expect(day("next fri")).toBe("2026-10-09");
  });

  it("reads month and day in either order, rolling past dates into next year", () => {
    expect(day("oct 2")).toBe("2026-10-02");
    expect(day("2 october")).toBe("2026-10-02");
    expect(day("jan 5")).toBe("2027-01-05");
    expect(day("sep 30")).toBe("2026-09-30");
    expect(day("feb 30")).toBeNull();
  });

  it("reads times, alone or after a day", () => {
    expect(parseNaturalDate("fri 3pm", today)).toEqual({ day: "2026-10-02", time: "15:00" });
    expect(parseNaturalDate("tomorrow at 9:30am", today)).toEqual({ day: "2026-10-01", time: "09:30" });
    expect(parseNaturalDate("oct 2 14:00", today)).toEqual({ day: "2026-10-02", time: "14:00" });
    expect(parseNaturalDate("12am", today)).toEqual({ day: today, time: "00:00" });
    expect(parseNaturalDate("13pm", today)).toBeNull();
  });

  it("accepts ISO dates and rejects ambiguous or unknown input", () => {
    expect(day("2026-12-24")).toBe("2026-12-24");
    expect(day("10/2")).toBeNull();
    expect(day("sam")).toBeNull();
    expect(day("")).toBeNull();
    expect(day("f")).toBeNull();
  });
});

describe("suggestDates", () => {
  it("offers the shortcuts on an empty query", () => {
    expect(suggestDates("", today).map((entry) => entry.label).slice(0, 3)).toEqual([
      "Today",
      "Tomorrow",
      "Next week",
    ]);
  });

  it("filters by prefix and puts an exact parse first", () => {
    expect(suggestDates("fr", today).map((entry) => entry.label)).toEqual(["Friday"]);
    const [first] = suggestDates("oct 12", today);
    expect(first).toMatchObject({ label: "oct 12", day: "2026-10-12" });
  });

  it("does not repeat a date", () => {
    const labels = suggestDates("to", today).map((entry) => entry.label);
    expect(labels).toEqual(["Today", "Tomorrow"]);
  });

  it("formats the directive", () => {
    expect(formatDueDirective({ day: "2026-10-02", time: null })).toBe(":due[2026-10-02]");
    expect(formatDueDirective({ day: "2026-10-02", time: "15:00" })).toBe(":due[2026-10-02 15:00]");
  });
});
