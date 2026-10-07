import { describe, expect, it } from "vitest";

import { parseCapture, parseDailyCapture } from "@/lib/tasks/capture";
import { parseTasks } from "@/lib/tasks/parse";

const today = "2026-09-30"; // a Wednesday
const line = (input: string) => parseCapture(input, today)?.line ?? null;

describe("parseCapture", () => {
  it("takes an unambiguous trailing date", () => {
    expect(line("send invoice friday")).toBe("- [ ] send invoice :due[2026-10-02]");
    expect(line("call Tom tomorrow at 9am")).toBe("- [ ] call Tom :due[2026-10-01 09:00]");
    expect(line("pay rent by oct 12")).toBe("- [ ] pay rent :due[2026-10-12]");
    expect(line("plan the offsite next week")).toBe("- [ ] plan the offsite :due[2026-10-05]");
  });

  it("leaves words that only look like dates alone", () => {
    expect(line("call Tom")).toBe("- [ ] call Tom");
    expect(line("the cat sat")).toBe("- [ ] the cat sat");
    expect(line("sit in the sun")).toBe("- [ ] sit in the sun");
    expect(line("read chapter 3")).toBe("- [ ] read chapter 3");
  });

  it("accepts loose forms when marked with @", () => {
    expect(line("pay rent @fri")).toBe("- [ ] pay rent :due[2026-10-02]");
    expect(line("call Tom @tom")).toBe("- [ ] call Tom :due[2026-10-01]");
  });

  it("never turns the whole text into a date", () => {
    expect(line("tomorrow")).toBe("- [ ] tomorrow");
  });

  it("cleans up what was typed", () => {
    expect(line("  - [ ] buy\n milk  ")).toBe("- [ ] buy milk");
    expect(parseCapture("   ", today)).toBeNull();
  });

  it("produces a line the parser reads back", () => {
    const [task] = parseTasks(line("send invoice friday 3pm") ?? "");
    expect(task).toMatchObject({ text: "send invoice", dueDay: "2026-10-02", dueTime: "15:00" });
  });
});

describe("parseDailyCapture", () => {
  it("schedules undated captures for the note's day", () => {
    const captured = parseDailyCapture("call Tom", today);
    expect(captured).toMatchObject({
      due: { day: today, time: null },
      line: "- [ ] call Tom :due[2026-09-30]",
    });
    expect(parseTasks(captured?.line ?? "")[0]).toMatchObject({ dueDay: today, text: "call Tom" });
  });

  it("keeps an explicit date instead of moving it to today", () => {
    expect(parseDailyCapture("send invoice friday", today)?.line)
      .toBe("- [ ] send invoice :due[2026-10-02]");
  });
});
