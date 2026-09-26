import { describe, expect, it } from "vitest";

import { parseFixtureState } from "@/lib/extension-host/fixtures";

const now = new Date(2026, 8, 26); // 26 September 2026, local time

describe("parseFixtureState", () => {
  it("resolves @today tokens anywhere in the state", () => {
    const rows = parseFixtureState(
      JSON.stringify({
        "calendar:a": {
          visibility: "public",
          state: { entries: { e1: { day: "@today" }, e2: { day: "@today+7" }, e3: { day: "@today-26" } } },
        },
      }),
      now,
    );

    expect(rows["calendar:a"]).toEqual({
      state: {
        entries: {
          e1: { day: "2026-09-26" },
          e2: { day: "2026-10-03" },
          e3: { day: "2026-08-31" },
        },
      },
      visibility: "public",
      version: 1,
    });
  });

  it("defaults visibility to private and leaves other strings alone", () => {
    const rows = parseFixtureState(JSON.stringify({ layout: { state: { note: "@todayish" } } }), now);
    expect(rows.layout).toEqual({ state: { note: "@todayish" }, visibility: "private", version: 1 });
  });

  it("rejects malformed files", () => {
    expect(() => parseFixtureState("[]", now)).toThrow(/object keyed by state key/);
    expect(() => parseFixtureState(JSON.stringify({ a: { state: 1 } }), now)).toThrow(/object "state"/);
    expect(() =>
      parseFixtureState(JSON.stringify({ a: { state: {}, visibility: "secret" } }), now),
    ).toThrow(/unknown visibility/);
  });
});
