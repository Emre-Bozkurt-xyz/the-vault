import { describe, expect, it } from "vitest";
import { nextRecurringDay, parseRecurrence } from "./recurrence";

describe("recurrence dates", () => {
  it("accepts strict presets and bounded intervals", () => {
    for (const rule of [
      "daily",
      "weekly",
      "monthly",
      "yearly",
      "every 2 weeks",
      "after 3 days",
    ])
      expect(parseRecurrence(rule)).not.toBeNull();
    for (const rule of [
      "",
      "sometimes",
      "every 0 days",
      "every -1 day",
      "every 366 days",
      "every 1 hour",
      "__proto__",
      "constructor",
    ])
      expect(parseRecurrence(rule)).toBeNull();
  });
  it("skips missed dates while preserving the fixed cadence", () => {
    expect(nextRecurringDay("every 2 weeks", "2026-09-01", "2026-10-06")).toBe(
      "2026-10-13",
    );
    expect(nextRecurringDay("daily", "2026-10-06", "2026-10-06")).toBe(
      "2026-10-07",
    );
    expect(nextRecurringDay("weekly", "2026-11-01", "2026-10-06")).toBe(
      "2026-11-08",
    );
  });
  it("supports intervals from completion and undated tasks", () => {
    expect(nextRecurringDay("after 2 weeks", "2026-09-01", "2026-10-06")).toBe(
      "2026-10-20",
    );
    expect(nextRecurringDay("weekly", null, "2026-10-06")).toBe("2026-10-13");
  });
  it("clamps month/year endings and skips missed monthly dates", () => {
    expect(nextRecurringDay("monthly", "2026-01-31", "2026-01-31")).toBe(
      "2026-02-28",
    );
    expect(nextRecurringDay("monthly", "2026-01-31", "2026-03-30")).toBe(
      "2026-03-31",
    );
    expect(nextRecurringDay("yearly", "2024-02-29", "2024-02-29")).toBe(
      "2025-02-28",
    );
    expect(nextRecurringDay("daily", "9999-12-31", "9999-12-31")).toBeNull();
  });
});


it("keeps monthly and leap-day anchors after a clamped occurrence", () => {
  expect(nextRecurringDay("monthly on 31", "2026-02-28", "2026-02-28")).toBe("2026-03-31");
  expect(nextRecurringDay("yearly on 02-29", "2027-02-28", "2027-02-28")).toBe("2028-02-29");
  for (const value of ["daily on 31", "after 1 month on 31", "monthly on 0", "monthly on 32", "yearly on 02-30"]) expect(parseRecurrence(value)).toBeNull();
});
