import { describe, expect, it } from "vitest";

import {
  addDaysToDayKey,
  daysBetween,
  formatDueLabel,
  nextWeekStart,
} from "@/lib/tasks/dates";

describe("task day keys", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysToDayKey("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysToDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDayKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("finds the coming Monday", () => {
    expect(nextWeekStart("2026-09-28")).toBe("2026-10-05"); // Monday → next Monday
    expect(nextWeekStart("2026-09-29")).toBe("2026-10-05"); // Tuesday
    expect(nextWeekStart("2026-10-04")).toBe("2026-10-05"); // Sunday
  });

  it("counts days in either direction", () => {
    expect(daysBetween("2026-09-28", "2026-10-02")).toBe(4);
    expect(daysBetween("2026-10-02", "2026-09-28")).toBe(-4);
  });

  it("labels relative to the supplied today", () => {
    const today = "2026-09-28"; // a Monday

    expect(formatDueLabel("2026-09-28", today)).toBe("Today");
    expect(formatDueLabel("2026-09-29", today)).toBe("Tomorrow");
    expect(formatDueLabel("2026-09-27", today)).toBe("Yesterday");
    expect(formatDueLabel("2026-10-02", today)).toBe("Fri");
    expect(formatDueLabel("2026-10-05", today)).toBe("Mon 5 Oct");
    expect(formatDueLabel("2026-09-24", today)).toBe("Thu 24 Sep");
    expect(formatDueLabel("2027-01-04", today)).toBe("Mon 4 Jan 2027");
  });
});
