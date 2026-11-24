"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  addCard,
  addColumn,
  deleteCard,
  moveCard,
  parseBoard,
  renameColumn,
  setCardDetails,
  setCardField,
  setCardStatus,
  setCardTitle,
  type BoardCard,
  type BoardColumn,
  type CardStatus,
} from "@/lib/board/markdown-board";
import { addDaysToDayKey, formatDueLabel, todayDayKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<CardStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};
const STATUS_STRIPE: Record<CardStatus, string> = {
  open: "bg-muted-foreground/40",
  in_progress: "bg-sky-500",
  done: "bg-emerald-500",
  cancelled: "bg-muted-foreground/25",
};
const PRIORITIES = ["high", "medium", "low"] as const;
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-slate-400",
};
const DUE_STEPS = [0, 1, 3, 7] as const;

type Drag = {
  line: number;
  ghost: HTMLElement;
  placeholder: HTMLElement;
  dx: number;
  dy: number;
  target: { column: number; index: number } | null;
};

/**
 * A `view: board` document as a board (`lib/board/markdown-board.ts`): its
 * `##` headings are columns and their task lines are cards. Every change goes
 * back through `onChange` as new Markdown; without `onChange` it is read-only
 * (readers, public pages).
 *
 * Hover a card and press Space (start/pause), W (done), P (priority), D (due)
 * or Enter (open), as in the Tasks list; drag cards between columns.
 */
export function DocumentBoard({ markdown, onChange }: { markdown: string; onChange?: (next: string) => void }) {
  const board = useMemo(() => parseBoard(markdown), [markdown]);
  const editable = Boolean(onChange);
  const [today] = useState(todayDayKey);
  const [hovered, setHovered] = useState<number | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | "column" | null>(null);
  const press = useRef<{ line: number; x: number; y: number; el: HTMLElement } | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ markdown, onChange });
  useEffect(() => {
    latest.current = { markdown, onChange };
  });

  const change = (transform: (current: string) => string) => {
    const { markdown: current, onChange: commit } = latest.current;
    if (!commit) return;
    const next = transform(current);
    if (next !== current) commit(next);
  };

  // Keys act on the card under the pointer, as in the Tasks list.
  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || hovered === null) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const card = parseBoard(latest.current.markdown).columns.flatMap((column) => column.cards).find((c) => c.line === hovered);
      if (!card) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        change((md) => setCardStatus(md, card.line, card.status === "in_progress" ? "open" : "in_progress"));
      } else if (key === "w") {
        change((md) => setCardStatus(md, card.line, card.status === "done" ? "open" : "done"));
      } else if (key === "p") {
        const next = card.priority ? PRIORITIES[PRIORITIES.indexOf(card.priority as never) + 1] ?? null : "high";
        change((md) => setCardField(md, card.line, "priority", next));
      } else if (key === "d") {
        const offset = card.due ? DUE_STEPS.findIndex((step) => addDaysToDayKey(today, step) === card.due) : -1;
        const next = offset === -1 && card.due ? null : DUE_STEPS[offset + 1];
        change((md) => setCardField(md, card.line, "due", next === undefined || next === null ? null : addDaysToDayKey(today, next)));
      } else if (key === "enter") {
        setOpenLine(card.line);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, hovered, today]);

  // Dragging: mouse and pen (on touch, open a card and pick its column).
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, line: number) => {
    if (!editable || event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest("button, input, textarea")) return;
    press.current = { line, x: event.clientX, y: event.clientY, el: event.currentTarget };
  };

  useEffect(() => {
    if (!editable) return;
    const move = (event: PointerEvent) => {
      const start = press.current;
      if (!start) return;
      if (!drag.current) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
        const rect = start.el.getBoundingClientRect();
        const ghost = start.el.cloneNode(true) as HTMLElement;
        Object.assign(ghost.style, { position: "fixed", width: `${rect.width}px`, zIndex: "60", pointerEvents: "none", transform: "rotate(2deg)", opacity: "0.95" });
        document.body.append(ghost);
        const placeholder = document.createElement("div");
        placeholder.className = "rounded-lg border border-dashed border-ring/70";
        placeholder.style.height = `${rect.height}px`;
        start.el.style.opacity = "0.35";
        drag.current = { line: start.line, ghost, placeholder, dx: start.x - rect.left, dy: start.y - rect.top, target: null };
      }
      const current = drag.current;
      current.ghost.style.left = `${event.clientX - current.dx}px`;
      current.ghost.style.top = `${event.clientY - current.dy}px`;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const column = under?.closest<HTMLElement>("[data-board-column]");
      if (!column) {
        current.placeholder.remove();
        current.target = null;
        return;
      }
      const list = column.querySelector<HTMLElement>("[data-board-cards]")!;
      const cards = [...list.querySelectorAll<HTMLElement>("[data-board-card]")].filter(
        (el) => Number(el.dataset.boardCard) !== current.line,
      );
      let index = cards.length;
      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      list.insertBefore(current.placeholder, cards[index] ?? null);
      current.target = { column: Number(column.dataset.boardColumn), index };
    };
    const up = () => {
      const start = press.current;
      press.current = null;
      const current = drag.current;
      drag.current = null;
      if (!start) return;
      start.el.style.opacity = "";
      if (!current) {
        setOpenLine(start.line);
        return;
      }
      current.ghost.remove();
      current.placeholder.remove();
      if (current.target) {
        const { column, index } = current.target;
        change((md) => moveCard(md, current.line, column, index));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [editable]);

  const openCard = openLine === null ? null : board.columns.flatMap((column) => column.cards).find((card) => card.line === openLine) ?? null;
  const total = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
  const done = board.columns.reduce((sum, column) => sum + column.cards.filter((card) => card.status === "done").length, 0);

  return (
    <div className="vault-board grid gap-3">
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? "No cards yet. Add one to a column, or write task lines under a ## heading."
          : `${done} of ${total} done${editable ? " · hover a card: Space start · W done · P priority · D due · Enter open" : ""}`}
      </p>
      <div className="flex items-start gap-3 overflow-x-auto pb-3" onPointerLeave={() => setHovered(null)}>
        {board.columns.map((column) => (
          <Column
            key={column.line}
            column={column}
            today={today}
            editable={editable}
            hovered={hovered}
            adding={adding === column.line}
            onHover={setHovered}
            onPointerDown={onPointerDown}
            onStartAdd={() => setAdding(column.line)}
            onAdd={(title) => {
              change((md) => addCard(md, column.line, title));
            }}
            onStopAdd={() => setAdding(null)}
            onRename={(name) => change((md) => renameColumn(md, column.line, name))}
          />
        ))}
        {editable ? (
          adding === "column" ? (
            <input
              autoFocus
              aria-label="New column"
              placeholder="Column name, then Enter"
              className="h-10 w-60 shrink-0 rounded-xl border border-ring bg-background px-3 text-sm"
              onKeyDown={(event) => {
                if (event.key === "Escape") setAdding(null);
                if (event.key === "Enter" && event.currentTarget.value.trim()) {
                  const name = event.currentTarget.value;
                  change((md) => addColumn(md, name));
                  setAdding(null);
                }
              }}
              onBlur={() => setAdding(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding("column")}
              className="flex h-10 w-48 shrink-0 items-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="size-4" /> Add column
            </button>
          )
        ) : null}
      </div>

      {editable && openCard ? (
        <CardSheet
          key={openCard.line}
          card={openCard}
          columns={board.columns}
          today={today}
          onClose={() => setOpenLine(null)}
          change={change}
          onMoved={(line) => setOpenLine(line)}
        />
      ) : null}
    </div>
  );
}

function Column({
  column,
  today,
  editable,
  hovered,
  adding,
  onHover,
  onPointerDown,
  onStartAdd,
  onAdd,
  onStopAdd,
  onRename,
}: {
  column: BoardColumn;
  today: string;
  editable: boolean;
  hovered: number | null;
  adding: boolean;
  onHover: (line: number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, line: number) => void;
  onStartAdd: () => void;
  onAdd: (title: string) => void;
  onStopAdd: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <section
      data-board-column={column.line}
      aria-label={column.heading}
      className="flex max-h-[75vh] w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30"
    >
      <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        {editable ? (
          <input
            defaultValue={column.heading}
            aria-label="Column name"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none focus:underline"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() && event.currentTarget.value !== column.heading) onRename(event.currentTarget.value);
            }}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{column.heading}</h3>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">{column.cards.length}</span>
      </header>
      <div data-board-cards className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
        {column.cards.map((card) => (
          <Card
            key={card.line}
            card={card}
            today={today}
            hovered={hovered === card.line}
            editable={editable}
            onHover={onHover}
            onPointerDown={onPointerDown}
          />
        ))}
        {column.otherLines > 0 ? (
          <p className="px-1 text-[0.7rem] text-muted-foreground/70">
            +{column.otherLines} other line{column.otherLines === 1 ? "" : "s"}, in Source
          </p>
        ) : null}
      </div>
      {editable ? (
        adding ? (
          <input
            autoFocus
            aria-label="New card"
            placeholder="Card title, then Enter"
            className="mx-2.5 mb-2.5 rounded-lg border border-ring bg-background px-2.5 py-1.5 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") onStopAdd();
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                onAdd(event.currentTarget.value);
                event.currentTarget.value = "";
              }
            }}
            onBlur={onStopAdd}
          />
        ) : (
          <button
            type="button"
            onClick={onStartAdd}
            className="mx-2.5 mb-2.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add card
          </button>
        )
      ) : null}
    </section>
  );
}

function Card({
  card,
  today,
  hovered,
  editable,
  onHover,
  onPointerDown,
}: {
  card: BoardCard;
  today: string;
  hovered: boolean;
  editable: boolean;
  onHover: (line: number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, line: number) => void;
}) {
  const doneSubtasks = card.subtasks.filter((subtask) => subtask.done).length;
  const finished = card.status === "done" || card.status === "cancelled";
  const late = card.due && !finished && card.due < today;

  return (
    <article
      data-board-card={card.line}
      tabIndex={editable ? 0 : undefined}
      aria-label={card.title}
      onPointerEnter={() => onHover(card.line)}
      onPointerDown={(event) => onPointerDown(event, card.line)}
      onFocus={() => onHover(card.line)}
      className={cn(
        "relative grid select-none gap-1.5 rounded-lg border border-border bg-card py-2 pl-3.5 pr-2.5 shadow-sm transition",
        editable && "cursor-grab active:cursor-grabbing",
        hovered && "border-foreground/30",
      )}
    >
      <span aria-hidden="true" className={cn("absolute bottom-2 left-0 top-2 w-[3px] rounded-r", STATUS_STRIPE[card.status])} />
      <p className={cn("text-sm leading-snug", finished && "text-muted-foreground line-through decoration-muted-foreground/50")}>
        {card.title || "Untitled card"}
      </p>
      {card.notes.length > 0 ? <p className="line-clamp-2 text-xs text-muted-foreground">{card.notes.join(" ")}</p> : null}
      {card.priority || card.due || card.subtasks.length || card.status === "in_progress" ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem] text-muted-foreground">
          {card.status === "in_progress" ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">In progress</span> : null}
          {card.priority ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 capitalize">
              <span className={cn("size-1.5 rounded-full", PRIORITY_DOT[card.priority] ?? "bg-muted-foreground")} />
              {card.priority}
            </span>
          ) : null}
          {card.due ? (
            <span className={cn("rounded bg-muted px-1.5 py-0.5", late && "text-destructive")}>
              {formatDueLabel(card.due, today)}
            </span>
          ) : null}
          {card.subtasks.length > 0 ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span className="h-1 w-8 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-emerald-500" style={{ width: `${(doneSubtasks / card.subtasks.length) * 100}%` }} />
              </span>
              {doneSubtasks}/{card.subtasks.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CardSheet({
  card,
  columns,
  today,
  onClose,
  change,
  onMoved,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  today: string;
  onClose: () => void;
  change: (transform: (current: string) => string) => void;
  onMoved: (line: number) => void;
}) {
  const column = columns.find((candidate) => candidate.cards.some((c) => c.line === card.line));
  const [notes, setNotes] = useState(card.notes.join("\n"));
  const saveDetails = (nextNotes: string, subtasks = card.subtasks) =>
    change((md) => setCardDetails(md, card.line, nextNotes.split("\n"), subtasks));

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-xs font-normal text-muted-foreground">## {column?.heading}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-5 overflow-y-auto p-4">
          <input
            defaultValue={card.title}
            aria-label="Card title"
            className="vault-display w-full bg-transparent text-2xl outline-none"
            onBlur={(event) => {
              if (event.currentTarget.value.trim() && event.currentTarget.value !== card.title) {
                const title = event.currentTarget.value;
                change((md) => setCardTitle(md, card.line, title));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <Field label="Status">
            <Choices
              value={card.status}
              options={(Object.keys(STATUS_LABEL) as CardStatus[]).map((status) => ({ value: status, label: STATUS_LABEL[status], dot: STATUS_STRIPE[status] }))}
              onChoose={(status) => change((md) => setCardStatus(md, card.line, status))}
            />
          </Field>
          <Field label="Priority">
            <Choices
              value={card.priority ?? ""}
              options={[...PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1), dot: PRIORITY_DOT[p] })), { value: "", label: "None", dot: "" }]}
              onChoose={(priority) => change((md) => setCardField(md, card.line, "priority", priority || null))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due">
              <input
                type="date"
                defaultValue={card.due ?? ""}
                aria-label="Due date"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                onChange={(event) => {
                  const due = event.currentTarget.value || null;
                  change((md) => setCardField(md, card.line, "due", due));
                }}
              />
              {card.due ? <span className="text-xs text-muted-foreground">{formatDueLabel(card.due, today)}</span> : null}
            </Field>
            <Field label="Column">
              <select
                value={column?.line ?? ""}
                aria-label="Column"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                onChange={(event) => {
                  const target = Number(event.currentTarget.value);
                  const targetColumn = columns.find((c) => c.line === target);
                  change((md) => moveCard(md, card.line, target, targetColumn?.cards.length ?? 0));
                  onMoved(-1);
                  onClose();
                }}
              >
                {columns.map((c) => (
                  <option key={c.line} value={c.line}>
                    {c.heading}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={notes}
              rows={4}
              aria-label="Notes"
              onChange={(event) => setNotes(event.currentTarget.value)}
              onBlur={() => saveDetails(notes)}
              className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm"
            />
          </Field>
          <Field label="Subtasks">
            <div className="grid gap-1.5">
              {card.subtasks.map((subtask, index) => (
                <label key={index} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subtask.done}
                    onChange={(event) =>
                      saveDetails(notes, card.subtasks.map((s, i) => (i === index ? { ...s, done: event.currentTarget.checked } : s)))
                    }
                  />
                  <span className={cn(subtask.done && "text-muted-foreground line-through")}>{subtask.text}</span>
                </label>
              ))}
              <input
                placeholder="Add a subtask, then Enter"
                aria-label="New subtask"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.currentTarget.value.trim()) {
                    saveDetails(notes, [...card.subtasks, { done: false, text: event.currentTarget.value.trim() }]);
                    event.currentTarget.value = "";
                  }
                }}
              />
            </div>
          </Field>
        </div>
        <div className="mt-auto flex border-t border-border p-3">
          <button
            type="button"
            onClick={() => {
              change((md) => deleteCard(md, card.line));
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-destructive transition hover:bg-destructive/10"
          >
            <Trash2 className="size-4" /> Delete card
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Choices<T extends string>({
  value,
  options,
  onChoose,
}: {
  value: T;
  options: { value: T; label: string; dot: string }[];
  onChoose: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value || "none"}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChoose(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
            option.value === value ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40",
          )}
        >
          {option.dot ? <span className={cn("size-1.5 rounded-full", option.dot)} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
