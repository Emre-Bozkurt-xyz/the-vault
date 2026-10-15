"use client";

import { useRef } from "react";
import {
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CircleCheck,
  CircleDashed,
  FileInput,
  FileSearch,
  FileText,
  Flag,
  Inbox,
  MoreHorizontal,
  Pencil,
  Repeat,
  RotateCcw,
  Sun,
  Sunrise,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ContextMenuController } from "@/components/ui/use-context-menu";
import { addDaysToDayKey, nextWeekStart } from "@/lib/tasks/dates";
import type { RowChange } from "@/lib/tasks/optimistic";
import { isTaskPriority, TASK_PRIORITIES, type TaskPriority, type TaskStatus } from "@/lib/tasks/parse";
import { cn } from "@/lib/utils";

/** A document offered in "Move to"; the Inbox is marked so it gets its icon. */
export type TaskMoveTarget = { id: string; title: string; inbox?: boolean };

/** "Move to" offers at most this many documents besides the Inbox. */
const maxMoveTargets = 6;

/** Inbox first, then the other documents the listed tasks live in. */
export function taskMoveTargets(
  tasks: Array<{ documentId: string; documentTitle: string }>,
  inboxDocumentId: string | null,
): TaskMoveTarget[] {
  const targets = new Map<string, TaskMoveTarget>();
  if (inboxDocumentId) {
    const inboxTitle = tasks.find((task) => task.documentId === inboxDocumentId)?.documentTitle;
    targets.set(inboxDocumentId, { id: inboxDocumentId, title: inboxTitle ?? "Inbox", inbox: true });
  }
  for (const task of tasks) {
    if (targets.size > maxMoveTargets) break;
    if (!targets.has(task.documentId)) targets.set(task.documentId, { id: task.documentId, title: task.documentTitle });
  }
  return [...targets.values()];
}

export const repeatPresets =["daily", "weekly", "monthly", "yearly", "every 2 weeks", "after 1 day", "after 1 week"];

export function sentenceCase(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

/**
 * The per-task "⋯" menu shared by every task list: edit, schedule, repeat,
 * priority, move, status, delete. "Pick date…" opens the browser's native
 * picker on a hidden input anchored to the button. Pass `contextMenu` (from
 * `useContextMenu`) to also open it by right-clicking the row.
 *
 * Omitted callbacks hide their items, so read-only or compact contexts can
 * offer a subset without a second menu.
 */
export function TaskActionsMenu({
  task,
  today,
  onChange,
  onEdit,
  onRequestMove,
  moveTargets = [],
  currentDocumentId,
  className,
  contextMenu,
}: {
  task: {
    priority: TaskPriority | null;
    repeat: string | null;
    status: TaskStatus;
    dueDay: string | null;
    dueTime: string | null;
  };
  today: string;
  onChange: (change: RowChange) => void;
  /** Starts inline editing of the task's words. */
  onEdit?: () => void;
  /** Opens the document search for "Move to → Other document…". */
  onRequestMove?: () => void;
  moveTargets?: TaskMoveTarget[];
  /** The task's own document, left out of "Move to". */
  currentDocumentId?: string;
  className?: string;
  contextMenu?: ContextMenuController;
}) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  // Rescheduling keeps the time of day a task already had.
  const setDue = (day: string | null) =>
    onChange(day === null ? { type: "due", day } : { type: "due", day, time: task.dueTime });
  const closed = task.status === "done" || task.status === "cancelled";
  const targets = moveTargets.filter((target) => target.id !== currentDocumentId);

  const pickDate = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  return (
    <span className="relative inline-flex">
      <DropdownMenu {...contextMenu?.rootProps}>
        <DropdownMenuTrigger
          ref={contextMenu?.triggerRef}
          aria-label="Task actions"
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted/70 hover:text-foreground data-popup-open:opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" {...contextMenu?.contentProps}>
          {onEdit ? (
            <>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> Edit text
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setDue(today)}>
              <Sun /> Today
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDue(addDaysToDayKey(today, 1))}>
              <Sunrise /> Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDue(nextWeekStart(today))}>
              <CalendarDays /> Next week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pickDate}>
              <CalendarClock /> Pick date…
            </DropdownMenuItem>
            {task.dueDay ? (
              <DropdownMenuItem onClick={() => setDue(null)}>
                <CalendarX2 /> Clear date
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Repeat /> Repeat
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={task.repeat?.split(" on ")[0] ?? "none"}
                  onValueChange={(value) =>
                    onChange({ type: "repeat", repeat: value === "none" ? null : value })
                  }
                >
                  {repeatPresets.map((rule) => (
                    <DropdownMenuRadioItem key={rule} value={rule}>
                      {sentenceCase(rule)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">Does not repeat</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag /> Priority
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={task.priority ?? "none"}
                  onValueChange={(value) => {
                    if (value === "none" || isTaskPriority(value)) {
                      onChange({ type: "priority", priority: value === "none" ? null : value });
                    }
                  }}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <DropdownMenuRadioItem key={priority} value={priority}>
                      {sentenceCase(priority)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">No priority</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {onRequestMove ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileInput /> Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-72">
                <DropdownMenuGroup>
                  {targets.map((target) => (
                    <DropdownMenuItem
                      key={target.id}
                      title={target.title}
                      onClick={() =>
                        onChange({ type: "move", targetDocumentId: target.id, targetTitle: target.title })
                      }
                    >
                      {target.inbox ? <Inbox /> : <FileText />}
                      <span className="truncate">{target.title}</span>
                    </DropdownMenuItem>
                  ))}
                  {targets.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onClick={onRequestMove}>
                    <FileSearch /> Other document…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {closed ? (
              <DropdownMenuItem onClick={() => onChange({ type: "status", status: "open" })}>
                <RotateCcw /> Reopen
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onChange({ type: "status", status: "done" })}>
                <CircleCheck /> Mark done
              </DropdownMenuItem>
            )}
            {task.status === "in_progress" ? (
              <DropdownMenuItem onClick={() => onChange({ type: "status", status: "open" })}>
                <CircleDashed /> Not started
              </DropdownMenuItem>
            ) : closed ? null : (
              <DropdownMenuItem onClick={() => onChange({ type: "status", status: "in_progress" })}>
                <CircleDashed /> In progress
              </DropdownMenuItem>
            )}
            {task.status === "cancelled" ? null : (
              <DropdownMenuItem onClick={() => onChange({ type: "status", status: "cancelled" })}>
                <Ban /> Cancel task
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onChange({ type: "delete" })}>
            <Trash2 /> Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={dateInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        defaultValue={task.dueDay ?? ""}
        onChange={(event) => {
          if (event.target.value) setDue(event.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 size-px opacity-0"
      />
    </span>
  );
}
