import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { applyTextEdits } from "./edit";
import {
  dedentTaskBlock,
  planBlockAppend,
  planBlockRemoval,
  planTaskDocumentEdit,
  planTaskRemoval,
  planTaskRestore,
} from "./document-edit";
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

describe("planTaskRemoval", () => {
  const remove = (source: string, line: number) => {
    const raw = source.split(/\r?\n/)[line];
    const removal = planTaskRemoval(source, line, raw);
    expect(removal).not.toBeNull();
    return { ...removal!, result: applyTextEdits(source, [removal!.edit]) };
  };

  it("removes the task with its note and subtasks, leaving neighbours alone", () => {
    const source = [
      "# Launch",
      "- [ ] Before",
      "- [ ] Ship it :due[2026-10-02]",
      "  a note line",
      "  - [x] Subtask",
      "- [ ] After",
      "",
    ].join("\n");
    const { result, block, lineIndex } = remove(source, 2);
    expect(result).toBe("# Launch\n- [ ] Before\n- [ ] After\n");
    expect(lineIndex).toBe(2);
    expect(block).toBe("- [ ] Ship it :due[2026-10-02]\n  a note line\n  - [x] Subtask");
  });

  it("removes a lone subtask only", () => {
    const source = "- [ ] Parent\n  - [ ] Child\n  - [ ] Sibling\n";
    expect(remove(source, 1).result).toBe("- [ ] Parent\n  - [ ] Sibling\n");
  });

  it("removes the last line of a document without a trailing newline", () => {
    expect(remove("Intro\n- [ ] Last", 1).result).toBe("Intro");
  });

  it("refuses a task that moved or became ambiguous", () => {
    expect(planTaskRemoval("- [ ] A\n- [ ] A\n", 5, "- [ ] A")).toBeNull();
    expect(planTaskRemoval("- [ ] A\n", 0, "- [ ] B")).toBeNull();
  });

  it("restores the block where it was, even after edits elsewhere", () => {
    const source = "# Plan\n- [ ] One\n- [ ] Two\n  - [ ] Two.a\n- [ ] Three\n";
    const { result, block, lineIndex } = remove(source, 2);
    expect(applyTextEdits(result, [planTaskRestore(result, lineIndex, block)])).toBe(source);

    const edited = `${result}- [ ] Four\n`;
    expect(applyTextEdits(edited, [planTaskRestore(edited, lineIndex, block)])).toBe(
      "# Plan\n- [ ] One\n- [ ] Two\n  - [ ] Two.a\n- [ ] Three\n- [ ] Four\n",
    );
  });

  it("appends the block when the document got shorter than its old line", () => {
    expect(applyTextEdits("Short", [planTaskRestore("Short", 9, "- [ ] Back")])).toBe(
      "Short\n- [ ] Back\n",
    );
  });
});

describe("moving blocks", () => {
  it("dedents a quoted or nested task block to the top level", () => {
    expect(dedentTaskBlock("  - [ ] Child\n    - [ ] Grandchild\n    note")).toBe(
      "- [ ] Child\n  - [ ] Grandchild\n  note",
    );
    expect(dedentTaskBlock("> - [ ] In a callout\n>   - [x] Sub")).toBe("- [ ] In a callout\n  - [x] Sub");
  });

  it("appends a block and removes it again for Undo", () => {
    const source = "# Target\n- [ ] Existing";
    const { edit, lineIndex } = planBlockAppend(source, "- [ ] Moved\n  - [ ] Sub");
    const appended = applyTextEdits(source, [edit]);
    expect(appended).toBe("# Target\n- [ ] Existing\n- [ ] Moved\n  - [ ] Sub\n");
    expect(lineIndex).toBe(2);

    const removal = planBlockRemoval(`Intro\n${appended}`, lineIndex, "- [ ] Moved\n  - [ ] Sub");
    expect(applyTextEdits(`Intro\n${appended}`, [removal!])).toBe("Intro\n# Target\n- [ ] Existing\n");
  });

  it("leaves an edited appended block in place", () => {
    expect(planBlockRemoval("- [ ] Moved and edited\n", 0, "- [ ] Moved")).toBeNull();
  });
});
