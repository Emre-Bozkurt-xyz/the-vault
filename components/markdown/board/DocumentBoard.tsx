"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import { Clock3, Plus, Trash2 } from "lucide-react";

import { CanvasMenu, CardMenu, LaneMenu, type CardAction, type LaneAction } from "@/components/markdown/board/BoardMenus";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useContextMenu } from "@/components/ui/use-context-menu";
import {
  addCard,
  addColumn,
  cardMarkdown,
  deleteCard,
  deleteColumn,
  duplicateCard,
  moveCard,
  moveColumn,
  setColumnStatus,
  sortColumn,
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
import { showWorkspaceToast } from "@/lib/workspace-toast";
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
 * between columns. Cards, columns and the empty canvas have right-click menus
 * (`BoardMenus.tsx`; on touch, a long press or the "⋯" button). The editor
 * around it supplies the header (`BoardBar`) and the Markdown panel.
 */
export function DocumentBoard({
  markdown,
  documentId = null,
  onChange,
  onReveal,
  sourceOpen,
  onToggleSource,
}: {
  markdown: string;
  /** For card covers that are the document's own images. */
  documentId?: string | null;
  onChange?: (next: string) => void;
  /** "Show in Markdown": select lines `from` (0-based) up to `to` in the Markdown panel. */
  onReveal?: (from: number, to: number) => void;
  /** Whether the Markdown panel is open, for the canvas menu's toggle. */
  sourceOpen?: boolean;
  onToggleSource?: () => void;
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
      // Not while typing, nor while a menu or dialog (its own typeahead) has the keys.
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']")) return;
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
    if (outsideOwnDom(event) || (event.target as HTMLElement).closest("button, input, textarea")) return;
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
    if (event.button !== 0 || event.pointerType === "touch" || outsideOwnDom(event)) return;
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

  // Which column is in view (the phone's column strip follows it).
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [activeLane, setActiveLane] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const onCanvasScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    setScrolled(el.scrollLeft > 40);
    const lanes = [...el.querySelectorAll<HTMLElement>(".vault-board-lane")];
    let best = 0;
    lanes.forEach((lane, index) => {
      if (Math.abs(lane.offsetLeft - el.scrollLeft) < Math.abs(lanes[best].offsetLeft - el.scrollLeft)) best = index;
    });
    setActiveLane(best);
  };
  const jumpToLane = (index: number) => {
    const lane = canvasRef.current?.querySelectorAll<HTMLElement>(".vault-board-lane")[index];
    lane?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const canvasMenu = useContextMenu();
  const [confirmDelete, setConfirmDelete] = useState<BoardColumn | null>(null);

  const columnOf = (line: number) => board.columns.find((column) => column.cards.some((card) => card.line === line));

  const cardAction = (card: BoardCard, action: CardAction) => {
    switch (action.type) {
      case "open":
        setOpenLine(card.line);
        break;
      case "status":
        change((md) => setCardStatus(md, card.line, action.status));
        break;
      case "priority":
        change((md) => setCardField(md, card.line, "priority", action.priority));
        break;
      case "due":
        change((md) => setCardField(md, card.line, "due", action.due));
        break;
      case "move": {
        const target = board.columns.find((column) => column.line === action.column);
        change((md) => moveCard(md, card.line, action.column, target?.cards.length ?? 0));
        break;
      }
      case "position": {
        const column = columnOf(card.line);
        if (column) change((md) => moveCard(md, card.line, column.line, action.to === "top" ? 0 : column.cards.length));
        break;
      }
      case "duplicate":
        change((md) => duplicateCard(md, card.line));
        break;
      case "copy":
        void navigator.clipboard
          ?.writeText(cardMarkdown(latest.current.markdown, card.line))
          .then(
            () => showWorkspaceToast({ message: "Copied the card as Markdown", durationMs: 2500 }),
            () => showWorkspaceToast({ message: "Couldn't copy the card", tone: "error" }),
          );
        break;
      case "reveal":
        onReveal?.(card.line, card.end);
        break;
      case "delete": {
        const block = cardMarkdown(latest.current.markdown, card.line);
        change((md) => deleteCard(md, card.line));
        showWorkspaceToast({
          message: `Deleted “${card.label || card.title || "card"}”`,
          action: { label: "Undo", run: () => change((md) => insertLines(md, card.line, block)) },
        });
        break;
      }
    }
  };

  const laneAction = (column: BoardColumn, action: LaneAction) => {
    switch (action.type) {
      case "add":
        setAdding(column.line);
        break;
      case "rename":
        // After the menu has handed focus back to its button.
        setTimeout(() => {
          const input = canvasRef.current?.querySelector<HTMLInputElement>(
            `[data-board-column="${column.line}"] .vault-board-lane-name`,
          );
          input?.focus();
          input?.select();
        }, 80);
        break;
      case "move":
        change((md) => moveColumn(md, column.line, action.direction));
        break;
      case "sort":
        change((md) => sortColumn(md, column.line, action.by));
        break;
      case "complete":
        change((md) => setColumnStatus(md, column.line, "done"));
        break;
      case "reveal":
        onReveal?.(column.line, column.end);
        break;
      case "delete":
        if (column.cards.length === 0 && column.otherLines === 0) change((md) => deleteColumn(md, column.line));
        else setConfirmDelete(column);
        break;
    }
  };

  const openCard = openLine === null ? null : board.columns.flatMap((column) => column.cards).find((card) => card.line === openLine) ?? null;

  return (
    <div className="vault-board">
      {board.columns.length > 1 ? (
        <nav className="vault-board-jump" aria-label="Columns">
          {board.columns.map((column, index) => (
            <button
              key={column.line}
              type="button"
              aria-current={index === activeLane ? "true" : undefined}
              style={{ "--board-accent": ACCENTS[index % ACCENTS.length] } as CSSProperties}
              onClick={() => jumpToLane(index)}
            >
              <span className="vault-board-swatch" aria-hidden="true" />
              <span className="truncate">{column.heading}</span>
              <span className="vault-board-jump-count">{column.cards.length}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div
        ref={canvasRef}
        className={cn("vault-board-canvas", panning && "is-panning")}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onScroll={onCanvasScroll}
        onContextMenu={editable ? canvasMenu.onContextMenu : undefined}
      >
        {editable ? (
          <CanvasMenu
            contextMenu={canvasMenu}
            sourceOpen={sourceOpen ?? null}
            canUndoScroll={scrolled}
            onAddColumn={() => setAdding("column")}
            onToggleSource={onToggleSource ?? null}
            onScrollStart={() => canvasRef.current?.scrollTo({ left: 0, behavior: "smooth" })}
          />
        ) : null}
        <div className="vault-board-lanes" onPointerLeave={() => setHovered(null)}>
          {board.columns.map((column, index) => (
            <Column
              key={column.line}
              column={column}
              columns={board.columns}
              index={index}
              accent={ACCENTS[index % ACCENTS.length]}
              today={today}
              documentId={documentId}
              editable={editable}
              hovered={hovered}
              adding={adding === column.line}
              onHover={setHovered}
              onPointerDown={onPointerDown}
              onOpenCard={setOpenLine}
              onCardAction={cardAction}
              onLaneAction={(action) => laneAction(column, action)}
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
                  {...singleLineEntry}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.currentTarget.value = "";
                      setAdding(null);
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  // Enter, the keyboard's own key, or tapping away all add it.
                  onBlur={(event) => {
                    const name = event.currentTarget.value;
                    if (name.trim()) change((md) => addColumn(md, name));
                    setAdding(null);
                  }}
                />
              </div>
            ) : (
              <button type="button" onClick={() => setAdding("column")} className="vault-board-lane-new">
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-4" aria-hidden="true" /> {board.columns.length === 0 ? "Add your first column" : "Add column"}
                </span>
                <small>## heading</small>
              </button>
            )
          ) : null}
        </div>
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
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        tone="destructive"
        icon={Trash2}
        title={`Delete “${confirmDelete?.heading ?? ""}”?`}
        description={
          confirmDelete
            ? `The column and its ${confirmDelete.cards.length} card${confirmDelete.cards.length === 1 ? "" : "s"}${confirmDelete.otherLines ? `, and ${confirmDelete.otherLines} other line${confirmDelete.otherLines === 1 ? "" : "s"} under its heading,` : ""} are removed from the document. Restore points still have them.`
            : undefined
        }
        confirmLabel="Delete column"
        onConfirm={() => {
          const column = confirmDelete;
          setConfirmDelete(null);
          if (column) change((md) => deleteColumn(md, column.line));
        }}
      />
    </div>
  );
}

/**
 * Props for the board's one-line "type, then Enter" fields. They sit inside
 * the editor's <form>, so a phone keyboard would otherwise offer "Next" (which
 * just moves focus to the next field, never pressing Enter); `enterKeyHint`
 * makes its action key an Enter. Enter handlers also `preventDefault()` so it
 * never submits that form.
 */
const singleLineEntry = { enterKeyHint: "enter", autoComplete: "off" } as const;

/**
 * True for an event that reached this element through a React portal (a menu
 * or dialog opened from inside it) rather than from its own DOM: React bubbles
 * portal events up the component tree, so a click in a card's menu would
 * otherwise also count as a click on the card.
 */
function outsideOwnDom(event: { currentTarget: EventTarget; target: EventTarget }): boolean {
  return !(event.currentTarget as Node).contains(event.target as Node);
}

/** `block` (lines joined by newlines) put back at line `at`: a deleted card's Undo. */
function insertLines(markdown: string, at: number, block: string): string {
  const all = markdown.replace(/\r\n?/g, "\n").split("\n");
  all.splice(Math.min(at, all.length), 0, ...block.split("\n"));
  return all.join("\n");
}

function Column({
  column,
  columns,
  index,
  accent,
  today,
  documentId,
  editable,
  hovered,
  adding,
  onHover,
  onPointerDown,
  onOpenCard,
  onCardAction,
  onLaneAction,
  onAdd,
  onStopAdd,
  onRename,
}: {
  column: BoardColumn;
  columns: BoardColumn[];
  index: number;
  accent: string;
  today: string;
  documentId: string | null;
  editable: boolean;
  hovered: number | null;
  adding: boolean;
  onHover: (line: number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, line: number) => void;
  onOpenCard: (line: number) => void;
  onCardAction: (card: BoardCard, action: CardAction) => void;
  onLaneAction: (action: LaneAction) => void;
  onAdd: (title: string) => void;
  onStopAdd: () => void;
  onRename: (name: string) => void;
}) {
  const menu = useContextMenu();
  return (
    <section
      data-board-column={column.line}
      aria-label={column.heading}
      className="vault-board-lane"
      style={{ "--board-accent": accent } as CSSProperties}
      onContextMenu={editable ? menu.onContextMenu : undefined}
    >
      <header className="vault-board-lane-head">
        <span className="vault-board-swatch" aria-hidden="true" />
        {editable ? (
          <input
            // Remounted when the heading changes elsewhere (Source, a collaborator).
            key={column.heading}
            defaultValue={column.heading}
            aria-label="Column name"
            className="vault-board-lane-name"
            enterKeyHint="done"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.currentTarget.value = column.heading;
                event.currentTarget.blur();
              }
            }}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() && event.currentTarget.value !== column.heading) onRename(event.currentTarget.value);
            }}
          />
        ) : (
          <h3 className="vault-board-lane-name truncate">{column.heading}</h3>
        )}
        <span className="vault-board-count">{column.cards.length}</span>
        {editable ? (
          <LaneMenu
            column={column}
            first={index === 0}
            last={index === columns.length - 1}
            contextMenu={menu}
            onAction={onLaneAction}
          />
        ) : null}
      </header>
      <div className="vault-board-lane-accent" aria-hidden="true" />
      <div data-board-cards className="vault-board-cards">
        {column.cards.map((card) => (
          <Card
            key={card.line}
            card={card}
            columns={columns}
            today={today}
            documentId={documentId}
            hovered={hovered === card.line}
            editable={editable}
            onHover={onHover}
            onPointerDown={onPointerDown}
            onOpen={onOpenCard}
            onAction={(action) => onCardAction(card, action)}
          />
        ))}
        {column.cards.length === 0 && editable ? <p className="vault-board-lane-empty">Drop cards here</p> : null}
        {column.otherLines > 0 ? (
          <p className="vault-board-other">
            +{column.otherLines} other line{column.otherLines === 1 ? "" : "s"}, in Markdown
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
            {...singleLineEntry}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.value = "";
                onStopAdd();
              }
              if (event.key === "Enter") {
                // Stays open for the next card.
                event.preventDefault();
                if (event.currentTarget.value.trim()) onAdd(event.currentTarget.value);
                event.currentTarget.value = "";
              }
            }}
            // A title left in the field when it loses focus (the phone
            // keyboard's Done, tapping away) is added, not dropped.
            onBlur={(event) => {
              if (event.currentTarget.value.trim()) onAdd(event.currentTarget.value);
              onStopAdd();
            }}
          />
        ) : (
          <button type="button" onClick={() => onLaneAction({ type: "add" })} className="vault-board-add">
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
  columns,
  today,
  documentId,
  hovered,
  editable,
  onHover,
  onPointerDown,
  onOpen,
  onAction,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  today: string;
  documentId: string | null;
  hovered: boolean;
  editable: boolean;
  onHover: (line: number | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, line: number) => void;
  onOpen: (line: number) => void;
  onAction: (action: CardAction) => void;
}) {
  const menu = useContextMenu();
  // Touch: a tap opens the card, a long press its menu (iOS has no
  // contextmenu event; Android's arrives too and just re-anchors the menu).
  const touch = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; menu: boolean } | null>(null);
  const doneSubtasks = card.subtasks.filter((subtask) => subtask.done).length;
  const finished = card.status === "done" || card.status === "cancelled";
  const late = card.due && !finished && card.due < today;
  const cover = card.cover ? coverSrc(card.cover, documentId) : null;

  const endTouch = () => {
    if (touch.current?.timer) clearTimeout(touch.current.timer);
    if (touch.current) touch.current.timer = null;
  };

  return (
    <article
      data-board-card={card.line}
      tabIndex={editable ? 0 : undefined}
      aria-label={card.label || card.title}
      onPointerEnter={() => onHover(card.line)}
      onPointerDown={(event) => {
        if (editable && event.pointerType === "touch" && !outsideOwnDom(event) && !(event.target as HTMLElement).closest("button")) {
          const el = event.currentTarget;
          const { clientX: x, clientY: y } = event;
          touch.current = {
            x,
            y,
            menu: false,
            timer: setTimeout(() => {
              if (!touch.current) return;
              touch.current.menu = true;
              navigator.vibrate?.(8);
              menu.onContextMenu({
                currentTarget: el,
                target: el,
                clientX: x,
                clientY: y,
                shiftKey: false,
                preventDefault() {},
                stopPropagation() {},
              } as unknown as ReactMouseEvent<HTMLElement>);
            }, 480),
          };
        }
        onPointerDown(event, card.line);
      }}
      onPointerMove={(event) => {
        const start = touch.current;
        if (start?.timer && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) endTouch();
      }}
      onPointerUp={(event) => {
        endTouch();
        // The finger lifting after a long press isn't a press outside the menu
        // it just opened (which would close it again).
        if (touch.current?.menu) event.stopPropagation();
      }}
      onPointerCancel={endTouch}
      onClick={(event) => {
        // Mouse clicks open through the drag handler; this is the tap.
        if (!editable || !touch.current || outsideOwnDom(event)) return;
        const opened = touch.current.menu;
        touch.current = null;
        if (opened) {
          event.stopPropagation();
          return;
        }
        if (!(event.target as HTMLElement).closest("button")) onOpen(card.line);
      }}
      onContextMenu={editable ? menu.onContextMenu : undefined}
      onFocus={() => onHover(card.line)}
      className={cn("vault-board-card", editable && "is-editable", hovered && "is-hovered", finished && "is-finished")}
    >
      {cover ? <CardCover key={cover} src={cover} /> : null}
      {editable ? <CardMenu card={card} columns={columns} today={today} contextMenu={menu} onAction={onAction} /> : null}
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
            <span className={cn("vault-board-due", late && "is-late")} title={card.due}>
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
          {editable ? (
            <button
              type="button"
              className={cn("vault-board-status", `is-${card.status}`)}
              aria-label={finished ? `${STATUS_LABEL[card.status]}: reopen` : `${STATUS_LABEL[card.status]}: mark done`}
              title={finished ? `${STATUS_LABEL[card.status]} · click to reopen` : `${STATUS_LABEL[card.status]} · click to mark done`}
              onClick={() => onAction({ type: "status", status: finished ? "open" : "done" })}
            />
          ) : (
            <span className={cn("vault-board-status", `is-${card.status}`)} title={STATUS_LABEL[card.status]} />
          )}
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
            enterKeyHint="done"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
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
                {...singleLineEntry}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
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
