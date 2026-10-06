import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { applyTextEdits } from "./edit";
import { planTaskDocumentEdit } from "./document-edit";
import { parseTasks } from "./parse";
const today = "2026-10-06";
function complete(source: string, line = 0, stampDone = true) {
  const raw = source.split(/\r?\n/)[line];
  const edits = planTaskDocumentEdit(
    source,
    line,
    raw,
    { type: "status", status: "done" },
    today,
    { stampDone },
  );
  expect(edits).not.toBeNull();
  return applyTextEdits(source, edits!);
}

describe("recurring completion", () => {
  it("archives the occurrence and creates exactly one next task with its time and priority", () => {
    const source =
      "- [ ] Ship :due[2026-10-01 09:30] :priority[high] :repeat[weekly]";
    const result = complete(source);
    expect(parseTasks(result)).toMatchObject([
      {
        status: "done",
        doneDay: today,
        repeat: null,
        dueDay: "2026-10-01",
        dueTime: "09:30",
        priority: "high",
      },
      {
        status: "open",
        doneDay: null,
        repeat: "weekly",
        dueDay: "2026-10-08",
        dueTime: "09:30",
        priority: "high",
      },
    ]);
    expect(complete(result)).toBe(result);
    const state = EditorState.create({ doc: source });
    expect(
      state
        .update({
          changes: planTaskDocumentEdit(
            source,
            0,
            source,
            { type: "status", status: "done" },
            today,
          )!,
        })
        .state.doc.toString(),
    ).toBe(result);
  });
  it("copies notes and nested checklist, shifts child dates, retains cancelled items", () => {
    const source =
      "# Work\n- [ ] Parent :due[2026-10-06] :repeat[weekly]\n  Keep **this note**.\n  - [x] Child :due[2026-10-05] :done[2026-10-05]\n  - [-] Cancelled\n\n- [ ] Sibling";
    const result = complete(source, 1);
    const tasks = parseTasks(result);
    expect(tasks).toMatchObject([
      { text: "Parent", status: "done", repeat: null },
      { text: "Child", status: "done", dueDay: "2026-10-05" },
      { text: "Cancelled", status: "cancelled" },
      {
        text: "Parent",
        status: "open",
        repeat: "weekly",
        dueDay: "2026-10-13",
        note: "Keep **this note**.",
      },
      {
        text: "Child",
        status: "open",
        dueDay: "2026-10-12",
        doneDay: null,
        parentOrdinal: 3,
      },
      { text: "Cancelled", status: "cancelled", parentOrdinal: 3 },
      { text: "Sibling", status: "open" },
    ]);
  });
  it("preserves CRLF and quote prefixes, and does not recur when Tasks is off", () => {
    const source = "> - [ ] Repeat :repeat[daily]\r\n>   note\r\n\r\nTail";
    const result = complete(source);
    expect(result).toContain(
      "> - [ ] Repeat :repeat[daily] :due[2026-10-07]\r\n>   note",
    );
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
    expect(complete(source, 0, false)).toBe(source.replace("[ ]", "[x]"));
  });
  it("leaves code, invalid rules, and source-typed completion alone", () => {
    expect(parseTasks(complete("- [ ] A `:repeat[daily]`"))).toHaveLength(1);
    expect(parseTasks(complete("- [ ] A :repeat[never]"))).toHaveLength(1);
    expect(parseTasks(complete("- [x] A :repeat[daily]"))).toHaveLength(1);
    expect(
      planTaskDocumentEdit(
        "- [ ] Changed",
        0,
        "- [ ] Old",
        { type: "status", status: "done" },
        today,
      ),
    ).toBeNull();
  });
  it("reopening and completing history cannot spawn another occurrence", () => {
    const result = complete("- [ ] A :repeat[daily]");
    const first = result.split("\n")[0];
    const open = applyTextEdits(
      result,
      planTaskDocumentEdit(
        result,
        0,
        first,
        { type: "status", status: "open" },
        today,
      )!,
    );
    expect(parseTasks(complete(open))).toHaveLength(2);
  });
});

it("moves unfinished subtasks forward without leaving duplicate open work in history", () => {
  const source =
    "- [ ] Parent :repeat[weekly] :due[2026-10-06]\n  - [/] WIP :repeat[daily] :due[2026-10-06]\n  - [ ] Pending";
  expect(parseTasks(complete(source))).toMatchObject([
    { text: "Parent", status: "done", repeat: null },
    { text: "WIP", status: "cancelled", repeat: null },
    { text: "Pending", status: "cancelled" },
    { text: "Parent", status: "open", repeat: "weekly" },
    { text: "WIP", status: "open", repeat: "daily", dueDay: "2026-10-13" },
    { text: "Pending", status: "open" },
  ]);
});


it("lets an outer recurring checklist own its cadence without generating nested history", () => {
  const source = "- [ ] Parent :repeat[weekly]\n  - [ ] Child :repeat[daily]";
  const result = complete(source, 1);
  expect(parseTasks(result)).toHaveLength(2);
  expect(parseTasks(result)[1]).toMatchObject({ status: "done", repeat: "daily" });
  const repeated = complete(result);
  expect(parseTasks(repeated)).toHaveLength(4);
  expect(parseTasks(repeated)[3]).toMatchObject({ status: "open", repeat: "daily" });
});


it("persists the original monthly day in the generated recurrence rule", () => {
  const source = "- [ ] Month end :repeat[monthly] :due[2026-01-31]";
  const edits = planTaskDocumentEdit(source, 0, source, { type: "status", status: "done" }, "2026-01-31")!;
  const next = parseTasks(applyTextEdits(source, edits))[1];
  expect(next).toMatchObject({ repeat: "monthly on 31", dueDay: "2026-02-28" });
  const following = planTaskDocumentEdit(next.rawLine, 0, next.rawLine, { type: "status", status: "done" }, "2026-02-28")!;
  expect(parseTasks(applyTextEdits(next.rawLine, following))[1].dueDay).toBe("2026-03-31");
});
