"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";

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
  type BoardCover,
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
const PRIORITY_COLOR: Record<string, string> = {
  high: "var(--board-high)",
  medium: "var(--board-medium)",
  low: "var(--board-low)",
};
/** Column and tag colours, in turn (`components.css`, `.vault-board-canvas`). */
const ACCENTS = ["var(--board-a1)", "var(--board-a2)", "var(--board-a3)", "var(--board-a4)", "var(--board-a5)"];
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
 * Drawn as a canvas: full-height lanes on a dotted background that pans when
 * you drag empty space. Hover a card and press Space (start/pause), W (done),
 * P (priority), D (due) or Enter (open), as in the Tasks list; drag cards
 * between columns. The editor around it supplies the header (`BoardBar`).
 */
export function DocumentBoard({
  markdown,
  documentId = null,
  onChange,
}: {
  markdown: string;
  /** For card covers that are the document's own images. */
  documentId?: string | null;
  onChange?: (next: string) => void;
}) {
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
        ghost.classList.add("vault-board-ghost");
        Object.assign(ghost.style, { position: "fixed", width: `${rect.width}px`, zIndex: "60", pointerEvents: "none" });
        document.body.append(ghost);
        const placeholder = document.createElement("div");
        placeholder.className = "vault-board-placeholder";
        placeholder.style.height = `${rect.height}px`;
        start.el.style.opacity = "0.35";
        drag.current = { line: start.line, ghost, placeholder, dx: start.x - rect.left, dy: start.y - rect.top, target: null };
      }
      const current = drag.current;
      current.ghost.style.left = `${event.clientX - current.dx}px`;
      current.ghost.style.top = `${event.clientY - current.dy}px`;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const column = under?.closest<HTMLElement>("[data-board-column]");
      document.querySelectorAll(".vault-board-lane.is-drop").forEach((lane) => {
        if (lane !== column) lane.classList.remove("is-drop");
      });
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
      column.classList.add("is-drop");
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
      document.querySelectorAll(".vault-board-lane.is-drop").forEach((lane) => lane.classList.remove("is-drop"));
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

  // Drag empty canvas to pan (mouse); touch scrolls it natively.
  const pan = useRef<{ x: number; y: number; left: number; top: number; el: HTMLElement } | null>(null);
  const [panning, setPanning] = useState(false);
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest(".vault-board-lane, .vault-board-lane-new, button, input, textarea, a")) return;
    const el = event.currentTarget;
    pan.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, el };
    el.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pan.current;
    if (!start) return;
    start.el.scrollLeft = start.left - (event.clientX - start.x);
    start.el.scrollTop = start.top - (event.clientY - start.y);
  };
  const endPan = () => {
    if (!pan.current) return;
    pan.current = null;
    setPanning(false);
  };

  const openCard = openLine === null ? null : board.columns.flatMap((column) => column.cards).find((card) => card.line === openLine) ?? null;

  return (
    <div
      className={cn("vault-board-canvas", panning && "is-panning")}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="vault-board-lanes" onPointerLeave={() => setHovered(null)}>
        {board.columns.map((column, index) => (
          <Column
            key={column.line}
            column={column}
            accent={ACCENTS[index % ACCENTS.length]}
            today={today}
            documentId={documentId}
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
        {board.columns.length === 0 && !editable ? <p className="vault-board-other">No columns yet.</p> : null}
        {editable ? (
          adding === "column" ? (
            <div className="vault-board-lane-new is-editing">
              <input
                autoFocus
                aria-label="New column"
                placeholder="Column name, then Enter"
                className="vault-board-add-input"
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
            </div>
          ) : (
            <button type="button" onClick={() => setAdding("column")} className="vault-board-lane-new">
              <span className="inline-flex items-center gap-1.5">
                <Plus className="size-4" aria-hidden="true" /> Add column
              </span>
              <small>## heading</small>
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
  accent,
  today,
  documentId,
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
  accent: string;
  today: string;
  documentId: string | null;
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
      className="vault-board-lane"
      style={{ "--board-accent": accent } as CSSProperties}
    >
      <header className="vault-board-lane-head">
        <span className="vault-board-swatch" aria-hidden="true" />
        {editable ? (
          <input
            defaultValue={column.heading}
            aria-label="Column name"
            className="vault-board-lane-name"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() && event.currentTarget.value !== column.heading) onRename(event.currentTarget.value);
            }}
          />
        ) : (
          <h3 className="vault-board-lane-name truncate">{column.heading}</h3>
        )}
        <span className="vault-board-count">{column.cards.length}</span>
      </header>
      <div className="vault-board-lane-accent" aria-hidden="true" />
      <div data-board-cards className="vault-board-cards">
        {column.cards.map((card) => (
          <Card
            key={card.line}
            card={card}
            today={today}
            documentId={documentId}
            hovered={hovered === card.line}
            editable={editable}
            onHover={onHover}
            onPointerDown={onPointerDown}
          />
        ))}
        {column.cards.length === 0 && editable ? <p className="vault-board-lane-empty">Drop cards here</p> : null}
        {column.otherLines > 0 ? (
          <p className="vault-board-other">
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
            className="vault-board-add-input mx-2.5 mb-3"
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
          <button type="button" onClick={onStartAdd} className="vault-board-add">
            <Plus className="size-3.5" aria-hidden="true" /> Add card
          </button>
        )
      ) : null}
    </section>
  );
}

function coverSrc(cover: BoardCover, documentId: string | null): string | null {
  if ("url" in cover) return cover.url;
  return documentId ? `/api/assets/${cover.assetId}/content?doc=${documentId}&r=display` : null;
}

/**
 * A card's cover, gone if it can't load (binned, private, offline). The check
 * on attach catches an image that failed before React was listening, as a
 * server-rendered one can.
 */
function CardCover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      className="vault-board-cover"
      src={src}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function tagColor(tag: string): string {
  let sum = 0;
  for (const char of tag) sum += char.codePointAt(0) ?? 0;
  return ACCENTS[sum % ACCENTS.length];
}

function SubtaskRing({ done, total }: { done: number; total: number }) {
  const radius = 6;
  const length = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 16 16" className="vault-board-ring" aria-hidden="true">
      <circle cx="8" cy="8" r={radius} fill="none" stroke="var(--muted)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="var(--board-done)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(done / total) * length} ${length}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

function Card({
  card,
  today,
  documentId,
  hovered,
  editable,
  onHover,
  onPointerDown,
}: {
  card: BoardCard;
  today: string;
  documentId: string | null;
  hovered: boolean;
  editable: boolean;
  onHover: (line: number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, line: number) => void;
}) {
  const doneSubtasks = card.subtasks.filter((subtask) => subtask.done).length;
  const finished = card.status === "done" || card.status === "cancelled";
  const late = card.due && !finished && card.due < today;
  const cover = card.cover ? coverSrc(card.cover, documentId) : null;

  return (
    <article
      data-board-card={card.line}
      tabIndex={editable ? 0 : undefined}
      aria-label={card.label || card.title}
      onPointerEnter={() => onHover(card.line)}
      onPointerDown={(event) => onPointerDown(event, card.line)}
      onFocus={() => onHover(card.line)}
      className={cn("vault-board-card", editable && "is-editable", hovered && "is-hovered", finished && "is-finished")}
    >
      {cover ? <CardCover key={cover} src={cover} /> : null}
      <div className="vault-board-card-body">
        <p className="vault-board-card-title">{card.label || card.title || "Untitled card"}</p>
        {card.notes.length > 0 ? <p className="vault-board-card-notes">{card.notes.join(" ")}</p> : null}
        {card.tags.length > 0 ? (
          <div className="vault-board-chips">
            {card.tags.map((tag) => (
              <span key={tag} className="vault-board-chip" style={{ "--chip": tagColor(tag) } as CSSProperties}>
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <div className="vault-board-meta">
          {card.priority ? (
            <span className="vault-board-priority">
              <i style={{ background: PRIORITY_COLOR[card.priority] ?? "var(--muted-foreground)" }} />
              {card.priority}
            </span>
          ) : null}
          {card.due ? (
            <span className={cn("vault-board-due", late && "is-late")}>
              <Clock3 className="size-3" aria-hidden="true" />
              {formatDueLabel(card.due, today)}
            </span>
          ) : null}
          <span className="flex-1" />
          {card.subtasks.length > 0 ? (
            <span className="vault-board-priority tabular-nums" title={`${doneSubtasks} of ${card.subtasks.length} subtasks done`}>
              <SubtaskRing done={doneSubtasks} total={card.subtasks.length} />
              {doneSubtasks}/{card.subtasks.length}
            </span>
          ) : null}
          <span className={cn("vault-board-status", `is-${card.status}`)} title={STATUS_LABEL[card.status]} />
        </div>
      </div>
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
