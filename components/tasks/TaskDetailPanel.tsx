"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarX2, Keyboard, ListChecks } from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { requestMoveTasks } from "@/components/tasks/MoveTasksDialog";
import { TaskActionsMenu } from "@/components/tasks/TaskActionsMenu";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import { TaskRepeatBadge } from "@/components/tasks/TaskRepeatBadge";
import { TaskTextEditor } from "@/components/tasks/TaskRow";
import type { RowChange } from "@/lib/tasks/optimistic";
import type { TaskStatus } from "@/lib/tasks/parse";
import { cn } from "@/lib/utils";
import type { TaskDetail } from "@/server/tasks-data";

/** Enough to write back to a task: where it is and what its line says. */
export type TaskRef = { documentId: string; ordinal: number; line: number; rawLine: string };

const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * The Tasks page's right context panel (plan §6.2): the focused task's text
 * (click to edit), status, date, location, note, subtasks and a few lines of
 * its source. With several tasks selected it points at the bulk bar instead.
 */
export function TaskDetailPanel({
  detail,
  today,
  loading,
  selectedCount = 0,
  folderPath,
  onChange,
  onOpen,
  onShowShortcuts,
}: {
  detail: TaskDetail | null;
  today: string;
  loading: boolean;
  /** More than one task selected: no single task to show. */
  selectedCount?: number;
  folderPath: string | null;
  onChange: (task: TaskRef, change: RowChange) => void;
  onOpen: (task: TaskRef) => void;
  onShowShortcuts?: () => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  if (!detail) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        {selectedCount > 1 ? (
          <p className="flex items-center gap-1.5 text-foreground">
            <ListChecks className="size-4" /> {selectedCount} tasks selected
          </p>
        ) : (
          <p>{loading ? "Loading…" : "Select a task to see its details."}</p>
        )}
        {selectedCount > 1 ? (
          <p className="mt-1 text-xs">Use the bar above the list, or the keyboard, to change them together.</p>
        ) : null}
        <div className="mt-4 grid gap-1 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Keyboard className="size-3.5" /> Keyboard
          </p>
          <p><Key>j</Key> <Key>k</Key> move · <Key>x</Key> tick · <Key>e</Key> edit</p>
          <p><Key>t</Key> today · <Key>m</Key> tomorrow · <Key>Delete</Key> delete</p>
          {onShowShortcuts ? (
            <button type="button" onClick={onShowShortcuts} className="mt-1 w-fit text-primary hover:underline">
              All shortcuts <Key>?</Key>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const { task, subtasks, context } = detail;
  const counted = subtasks.filter((subtask) => subtask.status !== "cancelled");
  const finished = counted.filter((subtask) => subtask.status === "done").length;
  const key = `${task.documentId}:${task.ordinal}:${task.rawLine}`;
  const editing = editingKey === key;

  return (
    // `minmax(0,1fr)`: the source <pre> scrolls sideways instead of widening
    // the whole panel past the context column's edge.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-3 py-3 text-sm">
      <section>
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Task
        </p>
        {editing ? (
          <div className="mt-2">
            <TaskTextEditor
              value={task.text}
              className="text-base"
              onCommit={(value) => {
                setEditingKey(null);
                if (value !== task.text) onChange(task, { type: "text", text: value });
              }}
              onCancel={() => setEditingKey(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            title="Edit text"
            onClick={() => setEditingKey(key)}
            className="vault-task-md -mx-1 mt-1.5 block w-[calc(100%+0.5rem)] rounded px-1 py-0.5 text-left text-base font-medium transition hover:bg-muted/60"
          >
            {task.text ? (
              <MarkdownDocument markdown={task.text} contained={false} disableLinks />
            ) : (
              <span className="italic text-muted-foreground">Untitled task</span>
            )}
          </button>
        )}
        <div className="mt-3 flex flex-wrap gap-1">
          {statuses.map((status) => (
            <button
              key={status.value}
              type="button"
              aria-pressed={task.status === status.value}
              onClick={() => onChange(task, { type: "status", status: status.value })}
              className={cn(
                "rounded border px-2 py-0.5 text-xs transition",
                task.status === status.value
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:text-foreground",
              )}
            >
              {status.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Due
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            // Remount when the stored date changes, so the field never shows a stale value.
            key={`${task.dueDay}-${task.dueTime}`}
            type="date"
            aria-label="Due date"
            defaultValue={task.dueDay ?? ""}
            onChange={(event) => {
              if (event.target.value) {
                onChange(task, { type: "due", day: event.target.value, time: task.dueTime });
              }
            }}
            className="h-8 min-w-[9rem] flex-1 rounded-md border border-border/70 bg-background px-2 text-sm"
          />
          <input
            key={`time-${task.dueDay}-${task.dueTime}`}
            type="time"
            aria-label="Due time"
            disabled={!task.dueDay}
            defaultValue={task.dueTime ?? ""}
            onChange={(event) => {
              if (task.dueDay) {
                onChange(task, { type: "due", day: task.dueDay, time: event.target.value || null });
              }
            }}
            className="h-8 w-[7.75rem] rounded-md border border-border/70 bg-background px-2 text-sm disabled:opacity-50"
          />
          {task.dueDay ? (
            <button
              type="button"
              aria-label="Clear date"
              title="Clear date"
              onClick={() => onChange(task, { type: "due", day: null })}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <CalendarX2 className="size-4" />
            </button>
          ) : null}
        </div>
      </section>

      <section className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Priority / repeat</span>
        <TaskPriorityBadge priority={task.priority} /> <TaskRepeatBadge repeat={task.repeat} />
        {!task.priority && !task.repeat ? <span className="text-sm">None</span> : null}
        <TaskActionsMenu
          task={task}
          today={today}
          onChange={(change) => onChange(task, change)}
          onEdit={() => setEditingKey(key)}
          onRequestMove={() => requestMoveTasks([task])}
          currentDocumentId={task.documentId}
        />
      </section>

      <section>
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          In
        </p>
        <p className="mt-2 text-sm">
          {folderPath ? <span className="text-muted-foreground">{folderPath} / </span> : null}
          {task.documentTitle}
          {task.heading ? <span className="text-muted-foreground"> › {task.heading}</span> : null}
        </p>
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open at this line <ArrowUpRight className="size-3" />
        </button>
      </section>

      {task.note ? (
        <section>
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Note
          </p>
          <div className="mt-2 text-sm">
            <MarkdownDocument markdown={task.note} contained={false} disableLinks />
          </div>
        </section>
      ) : null}

      {subtasks.length > 0 ? (
        <section>
          <p className="flex items-center justify-between text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Subtasks
            <span className="font-normal tabular-nums">
              {finished}/{counted.length}
            </span>
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${counted.length ? (finished / counted.length) * 100 : 0}%` }}
            />
          </div>
          <ul className="mt-2 grid gap-1">
            {subtasks.map((subtask) => {
              const done = subtask.status === "done";
              const ref = { ...subtask, documentId: task.documentId };
              return (
                <li key={subtask.ordinal} className="flex items-start gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={done ? "Mark not done" : "Mark done"}
                    onClick={() =>
                      onChange(ref, { type: "status", status: done ? "open" : "done" })
                    }
                    className="vault-task-box mt-[0.2rem] cursor-pointer"
                    data-status={subtask.status}
                  />
                  <span
                    className={cn(
                      "vault-task-md min-w-0 flex-1",
                      (done || subtask.status === "cancelled") && "text-muted-foreground line-through",
                    )}
                  >
                    <MarkdownDocument markdown={subtask.text || "Untitled"} contained={false} disableLinks />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Source
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-muted/30 py-1.5 text-[0.72rem] leading-5">
          {context.lines.map((line, index) => {
            const lineNumber = context.startLine + index;
            return (
              <div
                key={lineNumber}
                className={cn("px-2", lineNumber === task.line && "bg-primary/10 text-foreground")}
              >
                <span className="mr-2 inline-block w-6 select-none text-right text-muted-foreground/70">
                  {lineNumber + 1}
                </span>
                {line || " "}
              </div>
            );
          })}
        </pre>
      </section>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border/70 bg-muted/40 px-1 font-mono text-[0.68rem] text-foreground">
      {children}
    </kbd>
  );
}
