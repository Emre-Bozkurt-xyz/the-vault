/**
 * Live-mode task authoring (docs/24_TASKS_AND_AGENDA_PLAN.md §7, slice 3):
 *
 * - `TaskCheckboxWidget`: the rendered `[ ]`/`[/]`/`[x]`/`[-]` box. Clicking it
 *   toggles the task as one undo step, never moving the cursor into the line.
 * - `TaskDateWidget`: `:due[…]` / `:done[…]` shown as a chip ("Tomorrow",
 *   "Overdue · Mon"). Clicking a due chip opens the native date picker; the
 *   picker's own clear button removes the date.
 * - `taskDateCompletionSource`: typing `@` on a task line opens a date menu.
 *
 * What is gated on the Tasks extension (`taskAuthoringEnabled`): the `@` menu
 * and the `:done[…]` stamp on a click. Everything else is core Markdown and
 * works for every editor, since a checkbox should simply be clickable.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Facet, Transaction, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { todayDayKey } from "@/lib/tasks/dates";
import { isValidTaskDateValue } from "@/lib/markdown/task-directives";
import { daysBetween, formatDueLabel } from "@/lib/tasks/dates";
import { planTaskEdit } from "@/lib/tasks/edit";
import { formatDueDirective, suggestDates } from "@/lib/tasks/natural-date";
import { parseRecurrence } from "@/lib/tasks/recurrence";
import { isTaskPriority, TASK_MARKER_PATTERN, taskStatusFromMarker } from "@/lib/tasks/parse";

export const recurringTaskCompletion = Facet.define<((task: { line: number; rawLine: string }) => void) | null, ((task: { line: number; rawLine: string }) => void) | null>({
  combine: (values) => values[0] ?? null,
});

/** True when the viewer has the Tasks extension on. */
export const taskAuthoringEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

export type TaskDateField = {
  name: "due" | "done" | "priority" | "repeat";
  /** Offsets within the line. */
  from: number;
  to: number;
  value: string;
  valid: boolean;
};

/**
 * `:due[…]` / `:done[…]` on a line, skipping any inside inline code. A regex
 * rather than a Markdown parse because decorations rebuild on every change;
 * the parser in `lib/tasks/parse.ts` stays the authority for the index.
 */
export function findTaskFields(lineText: string): TaskDateField[] {
  const code: Array<[number, number]> = [];

  for (const match of lineText.matchAll(/(`+)[^`]*?\1/g)) {
    code.push([match.index, match.index + match[0].length]);
  }

  const fields: TaskDateField[] = [];

  for (const match of lineText.matchAll(/:(due|done|priority|repeat)\[([^\]\n]*)\]/g)) {
    const from = match.index;
    const to = from + match[0].length;
    const before = from > 0 ? lineText[from - 1] : " ";

    // A directive name must not continue a word (`a:due[x]` is prose).
    if (/[\w:]/.test(before)) continue;
    if (code.some(([start, end]) => from >= start && to <= end)) continue;

    const name = match[1] as TaskDateField["name"];
    const value = match[2].trim();
    fields.push({ name, from, to, value, valid: name === "repeat" ? Boolean(parseRecurrence(value)) : name === "priority" ? isTaskPriority(value) : isValidTaskDateValue(name, value) });
  }

  return fields;
}

export function findTaskDateFields(lineText: string): TaskDateField[] {
  return findTaskFields(lineText).filter((field) => field.name === "due" || field.name === "done");
}

function nextStatusOnClick(marker: string) {
  const status = taskStatusFromMarker(marker);
  return status === "done" || status === "cancelled" ? "open" : "done";
}

/** Toggles the task on the line holding `pos`. */
function toggleTaskAt(view: EditorView, pos: number) {
  if (!view.state.facet(EditorView.editable)) return;

  const line = view.state.doc.lineAt(pos);
  const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(line.text)?.[0] ?? "";
  const marker = TASK_MARKER_PATTERN.exec(line.text.slice(prefix.length));
  if (!marker) return;

  if (nextStatusOnClick(marker[1]) === "done" && view.state.facet(taskAuthoringEnabled) && findTaskFields(line.text).some((field) => field.name === "repeat" && field.valid)) {
    const complete = view.state.facet(recurringTaskCompletion);
    if (complete) {
      complete({ line: line.number - 1, rawLine: line.text });
      return;
    }
  }
  const edits = planTaskEdit(
    line.text,
    { type: "status", status: nextStatusOnClick(marker[1]) },
    todayDayKey(),
    { stampDone: view.state.facet(taskAuthoringEnabled) },
  );
  if (!edits?.length) return;

  view.dispatch({
    changes: edits.map((edit) => ({
      from: line.from + edit.from,
      to: line.from + edit.to,
      insert: edit.insert,
    })),
    annotations: [Transaction.userEvent.of("input.task"), isolateHistory.of("full")],
  });
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(widget: TaskCheckboxWidget) {
    return widget.marker === this.marker;
  }

  toDOM(view: EditorView) {
    const status = taskStatusFromMarker(this.marker) ?? "open";
    const box = document.createElement("span");
    box.className = "vault-cm-task-checkbox";
    box.dataset.checked = String(status === "done");
    box.dataset.status = status;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", status === "done" ? "true" : status === "in_progress" ? "mixed" : "false");
    box.setAttribute("aria-label", status === "done" ? "Mark not done" : "Mark done");

    // mousedown, not click: the editor would otherwise move the cursor into
    // the line first, revealing the source this widget stands in for.
    box.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggleTaskAt(view, view.posAtDOM(box));
    });

    return box;
  }

  ignoreEvent() {
    return true;
  }
}

type ChipState = "overdue" | "today" | "upcoming" | "met" | "done" | "invalid";

export class TaskDateWidget extends WidgetType {
  constructor(
    private readonly field: TaskDateField,
    private readonly taskDone: boolean,
    private readonly today: string,
  ) {
    super();
  }

  eq(widget: TaskDateWidget) {
    return (
      widget.field.name === this.field.name &&
      widget.field.value === this.field.value &&
      widget.field.to - widget.field.from === this.field.to - this.field.from &&
      widget.taskDone === this.taskDone &&
      widget.today === this.today
    );
  }

  private state(): ChipState {
    if (!this.field.valid) return "invalid";
    if (this.field.name === "priority" || this.field.name === "repeat") return "upcoming";
    if (this.field.name === "done") return "done";
    if (this.taskDone) return "met";
    const offset = daysBetween(this.today, this.field.value.slice(0, 10));
    return offset < 0 ? "overdue" : offset === 0 ? "today" : "upcoming";
  }

  private label(state: ChipState): string {
    if (state === "invalid") return `${this.field.name}: ${this.field.value || "?"}`;

    if (this.field.name === "repeat") return `Repeat: ${this.field.value}`;
    if (this.field.name === "priority") return `${this.field.value[0].toUpperCase()}${this.field.value.slice(1)} priority`;

    const [day, time] = this.field.value.split(/\s+/);
    const relative = formatDueLabel(day, this.today);

    if (state === "done") return `✓ ${relative}`;
    if (state === "overdue") return `Overdue · ${relative}${time ? ` ${time}` : ""}`;
    return `${relative}${time ? ` ${time}` : ""}`;
  }

  toDOM(view: EditorView) {
    const state = this.state();
    const chip = document.createElement("span");
    chip.className = "vault-cm-task-date";
    chip.dataset.kind = this.field.name;
    if (this.field.name === "priority") chip.dataset.priority = this.field.value;
    chip.dataset.state = state;
    chip.textContent = this.label(state);
    chip.title = this.field.name === "repeat" ? `Repeats ${this.field.value}` : this.field.name === "priority" ? `Priority: ${this.field.value}` : `${this.field.name === "done" ? "Completed" : "Due"} ${this.field.value}`;

    if (this.field.name !== "due" || !this.field.valid) {
      return chip;
    }

    // Reschedule through the browser's own date picker, anchored to the chip.
    const input = document.createElement("input");
    input.type = "date";
    input.tabIndex = -1;
    input.className = "vault-cm-task-date-input";
    input.value = this.field.value.slice(0, 10);
    const time = this.field.value.split(/\s+/)[1] ?? null;
    const length = this.field.to - this.field.from;

    input.addEventListener("change", () => {
      if (!view.state.facet(EditorView.editable)) return;

      const from = view.posAtDOM(chip);
      const doc = view.state.doc.toString();
      if (!doc.slice(from, from + length).startsWith(":due[")) return;

      if (input.value) {
        view.dispatch({
          changes: { from, to: from + length, insert: formatDueDirective({ day: input.value, time }) },
          annotations: [Transaction.userEvent.of("input.task"), isolateHistory.of("full")],
        });
      } else {
        const start = from > 0 && doc[from - 1] === " " ? from - 1 : from;
        view.dispatch({
          changes: { from: start, to: from + length, insert: "" },
          annotations: [Transaction.userEvent.of("delete.task"), isolateHistory.of("full")],
        });
      }
    });

    chip.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || !view.state.facet(EditorView.editable)) return;
      event.preventDefault();
      try {
        input.showPicker();
      } catch {
        input.focus();
      }
    });

    chip.append(input);
    chip.dataset.editable = "true";
    return chip;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * Pushes date-chip decorations for a task line. `isActive(from, to)` says
 * whether the cursor sits in a range, in which case its source stays visible.
 */
export function addTaskDateDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  lineText: string,
  taskDone: boolean,
  isActive: (from: number, to: number) => boolean,
) {
  const today = todayDayKey();

  for (const field of findTaskFields(lineText)) {
    const from = lineFrom + field.from;
    const to = lineFrom + field.to;

    if (!isActive(from, to)) {
      ranges.push(
        Decoration.replace({ widget: new TaskDateWidget(field, taskDone, today) }).range(from, to),
      );
    }
  }
}

/**
 * `@` on a task line opens a date menu: "@fri", "@tomorrow 3pm", "@oct 12".
 * Only after a space or at the start of the text, so an email address never
 * triggers it; only on task lines, so `@` in prose stays free for later uses.
 */
export function taskDateCompletionSource(context: CompletionContext): CompletionResult | null {
  if (!context.state.facet(taskAuthoringEnabled)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const trigger = /(?:^|\s)@([\w:]*(?: [\w:]+){0,3} ?)$/.exec(before);
  if (!trigger) return null;

  const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(line.text)?.[0] ?? "";
  const marker = TASK_MARKER_PATTERN.exec(line.text.slice(prefix.length));
  if (!marker || before.length < prefix.length + marker[0].length) return null;

  const query = trigger[1];
  const from = context.pos - query.length - 1;
  const suggestions = suggestDates(query, todayDayKey());
  if (suggestions.length === 0) return null;

  return {
    from,
    filter: false,
    options: suggestions.map(
      (suggestion, index): Completion => ({
        label: suggestion.label,
        detail: suggestion.detail,
        type: "text",
        boost: 99 - index,
        apply: (view, _completion, applyFrom, applyTo) => {
          const insert = formatDueDirective(suggestion);
          view.dispatch({
            changes: { from: applyFrom, to: applyTo, insert },
            selection: { anchor: applyFrom + insert.length },
            annotations: Transaction.userEvent.of("input.complete"),
          });
        },
      }),
    ),
  };
}

const indentPattern = /^[ \t]*/;
const childTaskPattern = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX/-])\](?=[ \t]|$)/;

function indentWidth(text: string): number {
  return (indentPattern.exec(text)?.[0] ?? "").replace(/\t/g, "    ").length;
}

/**
 * Done/total over a task's DIRECT subtasks (cancelled ones not counted), read
 * from the lines below it; null when it has none. Stops at the first line that
 * is not indented under the task, so it only walks the task's own block.
 */
export function subtaskProgress(doc: Text, lineNumber: number): { done: number; total: number } | null {
  const parentIndent = indentWidth(doc.line(lineNumber).text);
  let childIndent: number | null = null;
  let done = 0;
  let total = 0;

  for (let number = lineNumber + 1; number <= doc.lines; number += 1) {
    const text = doc.line(number).text;
    if (!text.trim()) continue;

    const indent = indentWidth(text);
    if (indent <= parentIndent) break;

    const marker = childTaskPattern.exec(text);
    if (!marker) continue;

    childIndent ??= indent;
    if (indent !== childIndent) continue;

    const status = taskStatusFromMarker(marker[1]);
    if (status === "cancelled") continue;
    total += 1;
    if (status === "done") done += 1;
  }

  return total > 0 ? { done, total } : null;
}

export class TaskProgressWidget extends WidgetType {
  constructor(
    private readonly done: number,
    private readonly total: number,
  ) {
    super();
  }

  eq(widget: TaskProgressWidget) {
    return widget.done === this.done && widget.total === this.total;
  }

  toDOM() {
    const badge = document.createElement("span");
    badge.className = "vault-cm-task-progress";
    badge.dataset.complete = String(this.done === this.total);
    badge.textContent = `${this.done}/${this.total}`;
    badge.title = `${this.done} of ${this.total} subtasks done`;
    return badge;
  }

  ignoreEvent() {
    return false;
  }
}
