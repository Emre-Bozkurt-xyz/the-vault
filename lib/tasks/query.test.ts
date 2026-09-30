import { describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_QUERY,
  describeTaskQuery,
  matchesTaskQuery,
  parseTaskQueryFence,
  plainTaskText,
  splitTaskQuerySegments,
} from "@/lib/tasks/query";

const today = "2026-09-30";

describe("parseTaskQueryFence", () => {
  it("reads a bare fence as the defaults", () => {
    expect(parseTaskQueryFence(":::tasks")).toEqual(DEFAULT_TASK_QUERY);
  });

  it("reads attributes, ignoring unknown or invalid ones", () => {
    expect(parseTaskQueryFence(':::tasks{scope=all due=week status=all tag=Work title="My week" x=1 due2=no}')).toEqual({
      scope: "all",
      due: "week",
      status: "all",
      tag: "work",
      title: "My week",
    });
    expect(parseTaskQueryFence(":::tasks{due=soon scope=everyone}")).toEqual(DEFAULT_TASK_QUERY);
  });

  it("rejects other fences", () => {
    expect(parseTaskQueryFence(":::calendar{id=abc}")).toBeNull();
    expect(parseTaskQueryFence("text :::tasks")).toBeNull();
  });
});

describe("splitTaskQuerySegments", () => {
  it("mounts blocks in place and skips fenced code", () => {
    const segments = splitTaskQuerySegments(["# Week", ":::tasks{due=week}", "after", "```", ":::tasks", "```"].join("\n"));

    expect(segments.map((segment) => segment.type)).toEqual(["markdown", "tasks", "markdown"]);
    expect(segments[2]).toEqual({ type: "markdown", markdown: "after\n```\n:::tasks\n```" });
  });
});

describe("matchesTaskQuery", () => {
  const q = (overrides: Partial<typeof DEFAULT_TASK_QUERY>) => ({ ...DEFAULT_TASK_QUERY, ...overrides });

  it("filters by status", () => {
    expect(matchesTaskQuery({ status: "in_progress", dueDay: null }, q({}), today)).toBe(true);
    expect(matchesTaskQuery({ status: "done", dueDay: null }, q({}), today)).toBe(false);
    expect(matchesTaskQuery({ status: "done", dueDay: null }, q({ status: "done" }), today)).toBe(true);
    expect(matchesTaskQuery({ status: "cancelled", dueDay: null }, q({ status: "all" }), today)).toBe(false);
  });

  it("filters by due window, keeping overdue work in week and month", () => {
    const week = q({ due: "week" });
    expect(matchesTaskQuery({ status: "open", dueDay: "2026-09-20" }, week, today)).toBe(true);
    expect(matchesTaskQuery({ status: "open", dueDay: "2026-10-06" }, week, today)).toBe(true);
    expect(matchesTaskQuery({ status: "open", dueDay: "2026-10-07" }, week, today)).toBe(false);
    expect(matchesTaskQuery({ status: "open", dueDay: null }, week, today)).toBe(false);
    expect(matchesTaskQuery({ status: "open", dueDay: null }, q({ due: "none" }), today)).toBe(true);
    expect(matchesTaskQuery({ status: "open", dueDay: "2026-09-29" }, q({ due: "overdue" }), today)).toBe(true);
  });

  it("filters by document tag", () => {
    const tagged = q({ tag: "work" });
    const tags = { a: ["work"] };
    expect(matchesTaskQuery({ status: "open", dueDay: null, documentId: "a" }, tagged, today, tags)).toBe(true);
    expect(matchesTaskQuery({ status: "open", dueDay: null, documentId: "b" }, tagged, today, tags)).toBe(false);
  });
});

describe("labels and text", () => {
  it("describes a query", () => {
    expect(describeTaskQuery({ ...DEFAULT_TASK_QUERY, scope: "all", due: "today" })).toBe("My tasks · due today");
    expect(describeTaskQuery({ ...DEFAULT_TASK_QUERY, title: "Launch" })).toBe("Launch");
  });

  it("strips Markdown syntax but keeps labels", () => {
    expect(plainTaskText("Review **the** [[doc:1|Spec]] and [site](https://x) `now` :calc[2+2]")).toBe(
      "Review the Spec and site now 2+2",
    );
  });
});
