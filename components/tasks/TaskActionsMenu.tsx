"use client";

import { useRef } from "react";
import {
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CircleDashed,
  MoreHorizontal,
  Flag,
  Sun,
  Sunrise,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addDaysToDayKey, nextWeekStart } from "@/lib/tasks/dates";
import type { TaskChange } from "@/lib/tasks/edit";
import {
  isTaskPriority,
  TASK_PRIORITIES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/parse";
import { cn } from "@/lib/utils";

/**
 * The per-task "⋯" menu shared by the sidebar agenda and the Tasks page:
 * reschedule (today, tomorrow, next week, a picked date, none), start or stop,
 * and cancel. "Pick date…" opens the browser's native picker on a hidden input
 * anchored to the menu button.
 */
export function TaskActionsMenu({
  task,
  today,
  onChange,
  className,
}: {
  task: {
    priority: TaskPriority | null;
    status: TaskStatus;
    dueDay: string | null;
    dueTime: string | null;
  };
  today: string;
  onChange: (change: TaskChange) => void;
  className?: string;
}) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  // Rescheduling keeps the time of day a task already had.
  const setDue = (day: string | null) =>
    onChange(
      day === null
        ? { type: "due", day }
        : { type: "due", day, time: task.dueTime },
    );

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
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Task actions"
          className={cn(
            "flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-muted/70 hover:text-foreground data-[popup-open]:opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
            <DropdownMenuItem onClick={() => setDue(null)}>
              <CalendarX2 /> Clear date
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag /> Priority
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={task.priority ?? "none"}
                  onValueChange={(value) => {
                    if (value === "none" || isTaskPriority(value))
                      onChange({
                        type: "priority",
                        priority: value === "none" ? null : value,
                      });
                  }}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <DropdownMenuRadioItem key={priority} value={priority}>
                      {priority[0].toUpperCase() + priority.slice(1)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">
                    No priority
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {task.status === "in_progress" ? (
              <DropdownMenuItem
                onClick={() => onChange({ type: "status", status: "open" })}
              >
                <CircleDashed /> Not started
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  onChange({ type: "status", status: "in_progress" })
                }
              >
                <CircleDashed /> In progress
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onChange({ type: "status", status: "cancelled" })}
            >
              <Ban /> Cancel task
            </DropdownMenuItem>
          </DropdownMenuGroup>
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
