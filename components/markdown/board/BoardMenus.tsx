"use client";

import { useRef } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpToLine,
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CircleCheck,
  CircleDashed,
  ClipboardCopy,
  Columns3,
  Copy,
  FileCode2,
  Flag,
  ListChecks,
  ListPlus,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  SquareArrowOutUpRight,
  SortAsc,
  Sun,
  Sunrise,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ContextMenuController } from "@/components/ui/use-context-menu";
import type { BoardCard, BoardColumn, CardSort, CardStatus } from "@/lib/board/markdown-board";
import { addDaysToDayKey, nextWeekStart } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

export type CardAction =
  | { type: "open" }
  | { type: "status"; status: CardStatus }
  | { type: "priority"; priority: string | null }
  | { type: "due"; due: string | null }
  | { type: "move"; column: number }
  | { type: "position"; to: "top" | "bottom" }
  | { type: "duplicate" }
  | { type: "copy" }
  | { type: "reveal" }
  | { type: "delete" };

export type LaneAction =
  | { type: "add" }
  | { type: "rename" }
  | { type: "move"; direction: -1 | 1 }
  | { type: "sort"; by: CardSort }
  | { type: "complete" }
  | { type: "reveal" }
  | { type: "delete" };

const PRIORITIES = ["high", "medium", "low"] as const;
const triggerClass =
  "vault-board-menu-trigger flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground";

/**
 * A card's menu — its "⋯" button, or a right-click (long-press on touch)
 * anywhere on the card. The same actions as the hover keys, which it shows as
 * shortcuts, plus moving, copying and deleting. Mirrors the Tasks list's menu.
 */
export function CardMenu({
  card,
  columns,
  today,
  contextMenu,
  onAction,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  today: string;
  contextMenu?: ContextMenuController;
  onAction: (action: CardAction) => void;
}) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const closed = card.status === "done" || card.status === "cancelled";
  const columnLine = columns.find((column) => column.cards.some((candidate) => candidate.line === card.line))?.line;
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
    <span className="vault-board-card-menu">
      <DropdownMenu {...contextMenu?.rootProps}>
        <DropdownMenuTrigger ref={contextMenu?.triggerRef} aria-label="Card actions" className={triggerClass}>
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52" {...contextMenu?.contentProps}>
          <DropdownMenuItem onClick={() => onAction({ type: "open" })}>
            <SquareArrowOutUpRight /> Open card <DropdownMenuShortcut>↵</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {closed ? (
              <DropdownMenuItem onClick={() => onAction({ type: "status", status: "open" })}>
                <RotateCcw /> Reopen <DropdownMenuShortcut>W</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onAction({ type: "status", status: "done" })}>
                <CircleCheck /> Mark done <DropdownMenuShortcut>W</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {card.status === "in_progress" ? (
              <DropdownMenuItem onClick={() => onAction({ type: "status", status: "open" })}>
                <CircleDashed /> Pause <DropdownMenuShortcut>Space</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : closed ? null : (
              <DropdownMenuItem onClick={() => onAction({ type: "status", status: "in_progress" })}>
                <CircleDashed /> Start <DropdownMenuShortcut>Space</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {card.status === "cancelled" ? null : (
              <DropdownMenuItem onClick={() => onAction({ type: "status", status: "cancelled" })}>
                <Ban /> Cancel
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarDays /> Due date
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onAction({ type: "due", due: today })}>
                  <Sun /> Today
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ type: "due", due: addDaysToDayKey(today, 1) })}>
                  <Sunrise /> Tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ type: "due", due: nextWeekStart(today) })}>
                  <CalendarDays /> Next week
                </DropdownMenuItem>
                <DropdownMenuItem onClick={pickDate}>
                  <CalendarClock /> Pick date…
                </DropdownMenuItem>
                {card.due ? (
                  <DropdownMenuItem onClick={() => onAction({ type: "due", due: null })}>
                    <CalendarX2 /> Clear date
                  </DropdownMenuItem>
                ) : null}
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
                  value={card.priority ?? "none"}
                  onValueChange={(value) => onAction({ type: "priority", priority: value === "none" ? null : String(value) })}
                >
                  {PRIORITIES.map((priority) => (
                    <DropdownMenuRadioItem key={priority} value={priority}>
                      <span className={cn("vault-board-priority-dot", `is-${priority}`)} aria-hidden="true" />
                      {priority[0].toUpperCase() + priority.slice(1)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="none">No priority</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Columns3 /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-64">
              <DropdownMenuGroup>
                {columns.map((column) => (
                  <DropdownMenuItem
                    key={column.line}
                    disabled={column.line === columnLine}
                    onClick={() => onAction({ type: "move", column: column.line })}
                  >
                    <span className="truncate">{column.heading}</span>
                    <DropdownMenuShortcut className="tracking-normal">{column.cards.length}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction({ type: "position", to: "top" })}>
                  <ArrowUpToLine /> Top of this column
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ type: "position", to: "bottom" })}>
                  <ArrowDownToLine /> Bottom of this column
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onAction({ type: "duplicate" })}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction({ type: "copy" })}>
              <ClipboardCopy /> Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction({ type: "reveal" })}>
              <FileCode2 /> Show in Markdown
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onAction({ type: "delete" })}>
            <Trash2 /> Delete card
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={dateInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        defaultValue={card.due ?? ""}
        onChange={(event) => {
          if (event.target.value) onAction({ type: "due", due: event.target.value });
        }}
        className="pointer-events-none absolute bottom-0 right-0 size-px opacity-0"
      />
    </span>
  );
}

/** A column's menu: its "⋯" button, or a right-click on its header or empty space. */
export function LaneMenu({
  column,
  first,
  last,
  contextMenu,
  onAction,
}: {
  column: BoardColumn;
  first: boolean;
  last: boolean;
  contextMenu?: ContextMenuController;
  onAction: (action: LaneAction) => void;
}) {
  const open = column.cards.some((card) => card.status !== "done" && card.status !== "cancelled");
  return (
    <DropdownMenu {...contextMenu?.rootProps}>
      <DropdownMenuTrigger ref={contextMenu?.triggerRef} aria-label="Column actions" className={triggerClass}>
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" {...contextMenu?.contentProps}>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onAction({ type: "add" })}>
            <ListPlus /> Add card
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction({ type: "rename" })}>
            <Pencil /> Rename
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={first} onClick={() => onAction({ type: "move", direction: -1 })}>
            <ArrowLeft /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={last} onClick={() => onAction({ type: "move", direction: 1 })}>
            <ArrowRight /> Move right
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={column.cards.length < 2}>
              <SortAsc /> Sort cards
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Rewrites the order in the Markdown</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onAction({ type: "sort", by: "priority" })}>
                  <Flag /> By priority
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ type: "sort", by: "due" })}>
                  <CalendarDays /> By due date
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ type: "sort", by: "status" })}>
                  <CircleDashed /> By status
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!open} onClick={() => onAction({ type: "complete" })}>
            <ListChecks /> Mark all done
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onAction({ type: "reveal" })}>
          <FileCode2 /> Show in Markdown
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onAction({ type: "delete" })}>
          <Trash2 /> Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The canvas's own menu, on a right-click in empty space. Its trigger is invisible. */
export function CanvasMenu({
  contextMenu,
  sourceOpen,
  canUndoScroll,
  onAddColumn,
  onToggleSource,
  onScrollStart,
}: {
  contextMenu?: ContextMenuController;
  sourceOpen: boolean | null;
  canUndoScroll: boolean;
  onAddColumn: () => void;
  onToggleSource: (() => void) | null;
  onScrollStart: () => void;
}) {
  return (
    <DropdownMenu {...contextMenu?.rootProps}>
      <DropdownMenuTrigger
        ref={contextMenu?.triggerRef}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute left-0 top-0 size-0 opacity-0"
      />
      <DropdownMenuContent align="start" className="min-w-48" {...contextMenu?.contentProps}>
        <DropdownMenuItem onClick={onAddColumn}>
          <Columns3 /> Add column
        </DropdownMenuItem>
        {onToggleSource ? (
          <DropdownMenuItem onClick={onToggleSource}>
            {sourceOpen ? <PanelRightClose /> : <PanelRightOpen />} {sourceOpen ? "Hide Markdown" : "Show Markdown"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={!canUndoScroll} onClick={onScrollStart}>
          <Undo2 /> Back to the first column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
