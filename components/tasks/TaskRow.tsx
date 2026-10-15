"use client";

import { useEffect, useRef, type DragEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { requestMoveTasks } from "@/components/tasks/MoveTasksDialog";
import { TaskActionsMenu, type TaskMoveTarget } from "@/components/tasks/TaskActionsMenu";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import { TaskRepeatBadge } from "@/components/tasks/TaskRepeatBadge";
import { useContextMenu } from "@/components/ui/use-context-menu";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { formatDueLabel } from "@/lib/tasks/dates";
import { normalizeTaskText } from "@/lib/tasks/edit";
import type { PatchableRow } from "@/lib/tasks/optimistic";
import { runTaskWrite, type RowChange } from "@/lib/tasks/task-writes";
import { cn } from "@/lib/utils";

export type TaskRowData = PatchableRow & {
  documentTitle: string;
  ordinal: number;
  line: number;
  heading: string | null;
};

/**
 * One task in any workspace list — sidebar agenda, Tasks page, week cells,
 * Done view, home Today — so a task looks and behaves the same wherever it
 * appears: four-state box, Markdown text (or the inline editor), a quiet
 * second line, and the "⋯" / right-click menu.
 *
 * `variant`:
 * - `sidebar`: the text links to the task's line in its document.
 * - `page`: the row is selectable (`onSelect`), double-click opens.
 * - `compact`: week-view cells; no menu, no due column.
 */
export function TaskRow({
  task,
  today,
  variant,
  context,
  showDue = true,
  editing = false,
  onEditingChange,
  focused = false,
  selected = false,
  onSelect,
  onOpen,
  onChange,
  moveTargets,
  draggable = false,
  onDragStart,
  id,
  trailing,
}: {
  task: TaskRowData;
  today: string;
  variant: "sidebar" | "page" | "compact";
  /** Where the task lives ("Folder / Document › Heading"); defaults to the document. */
  context?: string;
  showDue?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** The keyboard cursor (Tasks page). */
  focused?: boolean;
  /** Part of a multi-selection (Tasks page). */
  selected?: boolean;
  onSelect?: (event: MouseEvent) => void;
  onOpen?: () => void;
  /** Defaults to writing just this task; the Tasks page widens it to a selection. */
  onChange?: (change: RowChange) => void;
  moveTargets?: TaskMoveTarget[];
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  id?: string;
  /** Extra content at the end of the second line (e.g. a completion day). */
  trailing?: ReactNode;
}) {
  const menu = useContextMenu();
  const change = onChange ?? ((next: RowChange) => void runTaskWrite([task], next));
  const done = task.status === "done";
  const closed = done || task.status === "cancelled";
  const overdue = !closed && task.dueDay !== null && task.dueDay < today;
  const where = context ?? (task.heading ? `${task.documentTitle} › ${task.heading}` : task.documentTitle);
  const dueLabel =
    (showDue && task.dueDay ? formatDueLabel(task.dueDay, today) : "") +
    (task.dueTime ? `${showDue && task.dueDay ? " " : ""}${task.dueTime}` : "");
  const compact = variant === "compact";

  const text = editing ? (
    <TaskTextEditor
      value={task.text}
      onCommit={(value) => {
        onEditingChange?.(false);
        if (value !== task.text) change({ type: "text", text: value });
      }}
      onCancel={() => onEditingChange?.(false)}
    />
  ) : (
    <span className={cn("vault-task-md block", closed ? "text-muted-foreground line-through" : "text-foreground")}>
      {task.text ? (
        <MarkdownDocument markdown={task.text} contained={false} disableLinks />
      ) : (
        <span className="italic text-muted-foreground">Untitled task</span>
      )}
    </span>
  );

  const meta = (
    <span
      className={cn(
        "mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        compact && "text-[0.7rem]",
      )}
    >
      <TaskPriorityBadge priority={task.priority} />
      <TaskRepeatBadge repeat={task.repeat} />
      <span className="min-w-0 truncate">{where}</span>
      {trailing}
      {variant === "sidebar" && dueLabel ? (
        <span className={cn("ml-auto shrink-0 tabular-nums", overdue && "text-destructive")}>{dueLabel}</span>
      ) : null}
      {compact && task.dueTime ? <span className="shrink-0 tabular-nums">{task.dueTime}</span> : null}
    </span>
  );

  return (
    <div
      id={id}
      role={variant === "sidebar" ? undefined : "option"}
      aria-selected={variant === "sidebar" ? undefined : focused || selected}
      tabIndex={variant === "sidebar" ? undefined : -1}
      draggable={draggable && !editing}
      onDragStart={onDragStart}
      onClick={editing ? undefined : onSelect}
      onDoubleClick={editing ? undefined : onOpen}
      onContextMenu={compact || editing ? undefined : menu.onContextMenu}
      className={cn(
        "group relative grid items-start rounded-md py-1.5 transition",
        compact
          ? "grid-cols-[0.95rem_minmax(0,1fr)] gap-x-1.5 px-1.5 text-[0.8rem] leading-snug"
          : variant === "sidebar"
            ? "grid-cols-[0.95rem_minmax(0,1fr)_1.5rem] gap-x-2 rounded-[5px] px-2 text-sm hover:bg-sidebar-accent"
            : "grid-cols-[0.95rem_minmax(0,1fr)_auto_1.5rem] gap-x-2 px-2 text-sm",
        variant !== "sidebar" && "cursor-default",
        variant !== "sidebar" && (selected ? "bg-primary/10" : focused ? "bg-muted/60" : "hover:bg-muted/50"),
        focused && variant !== "sidebar" && "ring-1 ring-primary/40",
        draggable && !editing && "cursor-grab active:cursor-grabbing",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark not done" : "Mark done"}
        title={done ? "Mark not done" : "Mark done"}
        onClick={(event) => {
          event.stopPropagation();
          change({ type: "status", status: closed ? "open" : "done" });
        }}
        className="vault-task-box mt-[0.2rem] cursor-pointer"
        data-status={task.status}
        data-overdue={overdue ? "true" : undefined}
      />

      {variant === "sidebar" && !editing ? (
        <Link
          href={`/docs/${task.documentId}`}
          onClick={() => requestEditorJump({ documentId: task.documentId, line: task.line, text: task.rawLine })}
          className="min-w-0 group-hover:text-sidebar-accent-foreground"
        >
          {text}
          {meta}
        </Link>
      ) : (
        <span className="min-w-0">
          {text}
          {meta}
        </span>
      )}

      {variant === "page" ? (
        <span className={cn("pt-0.5 text-xs tabular-nums text-muted-foreground", overdue && "text-destructive")}>
          {dueLabel}
        </span>
      ) : null}

      {compact ? null : (
        <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <TaskActionsMenu
            task={task}
            today={today}
            onChange={change}
            onEdit={onEditingChange ? () => onEditingChange(true) : undefined}
            onRequestMove={() => requestMoveTasks([task])}
            moveTargets={moveTargets}
            currentDocumentId={task.documentId}
            contextMenu={menu}
            className="opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          />
        </span>
      )}
    </div>
  );
}

/**
 * Inline editor for a task's words, the same field as renaming in the Files
 * panel: Enter or leaving saves, Escape cancels, nothing changed is no write.
 * The task's date, priority and repeat are not part of it and are kept.
 */
export function TaskTextEditor({
  value,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = normalizeTaskText(inputRef.current?.value ?? "");
    if (commit && next) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      defaultValue={value}
      aria-label="Task text"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className={cn(
        "-my-0.5 w-full rounded border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus:border-primary",
        className,
      )}
    />
  );
}
