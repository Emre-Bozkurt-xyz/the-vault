"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CalendarDays, FileText, Plus, X } from "lucide-react";

import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import { TaskRepeatBadge } from "@/components/tasks/TaskRepeatBadge";
import { useTaskTargets } from "@/components/tasks/use-task-targets";
import { Badge } from "@/components/ui/badge";
import { parseCapture } from "@/lib/tasks/capture";
import { captureTaskFromClient } from "@/lib/tasks/capture-client";
import { formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

/** A `#query` being typed at the end of the text. */
const hashQueryPattern = /(?:^|\s)#([^\s#[\]]*)$/;

/**
 * The one "Add task…" field (sidebar, quick-add dialog). Typing extras at the
 * end — a date, `!high`, `every week`, `#Document` — shows what was understood
 * as chips under the field before anything is saved; `#` offers the user's
 * documents, and picking one makes it the destination.
 */
export function TaskCaptureInput({
  size = "panel",
  autoFocus = false,
  onCaptured,
}: {
  size?: "panel" | "dialog";
  autoFocus?: boolean;
  onCaptured?: () => void;
}) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [today] = useState(todayDayKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, today) : null), [text, today]);
  const hashQuery = hashQueryPattern.exec(text)?.[1] ?? null;
  const picking = hashQuery !== null && hashQuery !== dismissed;
  const suggestions = useTaskTargets(picking ? hashQuery : null);
  const options = picking ? (suggestions ?? []) : [];
  const open = picking && options.length > 0;

  const pick = (index: number) => {
    const document = options[index];
    if (!document) return;
    setTarget({ id: document.id, title: document.title || "Untitled document" });
    setText((current) => current.replace(hashQueryPattern, "").trimEnd() + (current.trim() ? " " : ""));
    setActive(0);
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    const result = await captureTaskFromClient(text, { targetDocumentId: target?.id ?? null });
    setSaving(false);
    if (result.ok) {
      setText("");
      setTarget(null);
      onCaptured?.();
    }
    inputRef.current?.focus();
  };

  // A typed `#Title` the user did not pick still shows as a request.
  const typedTarget = !target && parsed?.target ? parsed.target : null;
  const showPreview = Boolean(
    target || parsed?.due || parsed?.priority || parsed?.repeat || typedTarget,
  );
  const dialog = size === "dialog";

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label
        className={cn(
          "flex items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
          dialog ? "h-10 px-3" : "h-8",
        )}
      >
        <Plus className={cn("shrink-0 text-muted-foreground", dialog ? "size-4" : "size-3.5")} aria-hidden />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setActive((index) =>
                event.key === "ArrowDown" ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0),
              );
            } else if (open && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              pick(active);
            } else if (open && event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(hashQuery);
            } else if (event.key === "Backspace" && !text && target) {
              setTarget(null);
            }
          }}
          placeholder={dialog ? "Call Sam friday 3pm !high #Work" : "Add task…"}
          title="A date, !high, every week or #Document at the end are picked up."
          aria-label="Add a task"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
          disabled={saving}
          autoComplete="off"
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-60",
            dialog ? "text-[0.95rem]" : "text-sm",
          )}
        />
      </label>

      {open ? (
        <div
          role="listbox"
          id={listboxId}
          aria-label="Add to document"
          className="absolute inset-x-0 top-full z-30 mt-1 grid max-h-64 gap-0.5 overflow-y-auto rounded-md border border-border/70 bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((document, index) => (
            <button
              key={document.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(index)}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-left text-sm",
                index === active ? "bg-muted text-foreground" : "text-foreground/90",
              )}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{document.title || "Untitled document"}</span>
              {document.path ? (
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{document.path}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {showPreview ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {parsed?.due ? (
            <Badge variant="outline">
              <CalendarDays aria-hidden />
              {formatDueLabel(parsed.due.day, today)}
              {parsed.due.time ? ` ${parsed.due.time}` : ""}
            </Badge>
          ) : null}
          <TaskPriorityBadge priority={parsed?.priority} />
          <TaskRepeatBadge repeat={parsed?.repeat} />
          {target ? (
            <Badge variant="secondary" className="max-w-full">
              <FileText aria-hidden />
              <span className="truncate">{target.title}</span>
              <button
                type="button"
                aria-label={`Don't add to ${target.title}`}
                onClick={() => setTarget(null)}
                className="-mr-1 rounded-sm opacity-70 transition hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : typedTarget ? (
            <Badge variant="outline" title="Added there if you have a document with exactly this title">
              <FileText aria-hidden />
              {typedTarget}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
