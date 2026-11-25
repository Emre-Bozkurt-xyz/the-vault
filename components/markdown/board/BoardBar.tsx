"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { FolderOpen, Keyboard, MoreHorizontal, PanelRightClose, PanelRightOpen, Smile } from "lucide-react";

import { IconPicker } from "@/components/markdown/DocumentPageArt";
import type { Board } from "@/lib/board/markdown-board";
import { cn } from "@/lib/utils";

/** Done and in-progress counts for the header's progress bar. */
export function boardProgress(board: Board) {
  const cards = board.columns.flatMap((column) => column.cards);
  return {
    total: cards.length,
    done: cards.filter((card) => card.status === "done").length,
    doing: cards.filter((card) => card.status === "in_progress").length,
  };
}

/**
 * A board document's header: one row in place of the page's toolbar, cover,
 * title block and Properties, so the board below it gets the window. Folder,
 * icon and title on the left; progress, people, the keys, the properties
 * (tucked into a popover) and the Markdown panel's toggle on the right — a
 * panel toggle like the workspace's own, since the board stays in view.
 */
export function BoardBar({
  folderPath,
  icon,
  onSetIcon,
  title,
  onTitleChange,
  progress,
  sourceOpen,
  onToggleSource,
  extras,
  properties,
}: {
  folderPath?: string | null;
  icon: string | null;
  /** Null when the icon can't be changed here. */
  onSetIcon: ((icon: string | null) => void) | null;
  title: string;
  /** Null for a read-only title. */
  onTitleChange: ((title: string) => void) | null;
  progress: { total: number; done: number; doing: number };
  sourceOpen: boolean;
  onToggleSource: () => void;
  /** Backlinks, collaborators: shown before the view switch. */
  extras?: ReactNode;
  /** The document's properties, in the ⋯ popover. */
  properties?: ReactNode;
}) {
  const folder = folderPath?.split("/").pop();
  const share = (count: number) => (progress.total ? `${(count / progress.total) * 100}%` : "0%");

  return (
    <div className="vault-board-bar">
      {folder ? (
        <span className="vault-board-crumb" title={folderPath ?? undefined}>
          <FolderOpen className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Folder: </span>
          {folder}
          <span aria-hidden="true" className="opacity-50">
            /
          </span>
        </span>
      ) : null}
      <div className="vault-board-title">
        {onSetIcon ? (
          <IconPicker icon={icon} onSetIcon={onSetIcon}>
            {icon ? <span className="text-xl leading-none">{icon}</span> : <Smile className="size-4 text-muted-foreground" />}
          </IconPicker>
        ) : icon ? (
          <span className="text-xl leading-none" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {onTitleChange ? (
          <input
            name="title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            aria-label="Document title"
            className="vault-display"
            size={Math.max(8, Math.min(40, title.length + 1))}
          />
        ) : (
          <h1 className="vault-display">{title || "Untitled document"}</h1>
        )}
      </div>
      {progress.total > 0 ? (
        <span className="vault-board-progress">
          <span className="vault-board-pbar" aria-hidden="true">
            <i style={{ width: share(progress.done), background: "var(--board-done)" }} />
            <i style={{ width: share(progress.doing), background: "var(--board-doing)" }} />
          </span>
          {progress.done} of {progress.total} done
        </span>
      ) : null}
      <span className="flex-1" />
      {extras}
      <BarPopover label="Keyboard shortcuts" icon={<Keyboard className="size-4" />} className="vault-board-keys-button">
        <p className="vault-board-pop-heading">Hover a card</p>
        <dl className="vault-board-keys">
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>Start or pause</dd>
          <dt>
            <kbd>W</kbd>
          </dt>
          <dd>Done</dd>
          <dt>
            <kbd>P</kbd>
          </dt>
          <dd>Cycle priority</dd>
          <dt>
            <kbd>D</kbd>
          </dt>
          <dd>Cycle due date</dd>
          <dt>
            <kbd>Enter</kbd>
          </dt>
          <dd>Open the card</dd>
        </dl>
        <p className="vault-board-pop-heading">Canvas</p>
        <dl className="vault-board-keys">
          <dt>
            <kbd>Drag</kbd>
          </dt>
          <dd>Empty space to pan</dd>
          <dt>
            <kbd>Right-click</kbd>
          </dt>
          <dd>A card, column or the canvas for its actions</dd>
          <dt>
            <kbd>#tag</kbd>
          </dt>
          <dd>In a card&apos;s text, a chip</dd>
          <dt>
            <kbd>Image</kbd>
          </dt>
          <dd>A card&apos;s first image line is its cover</dd>
        </dl>
      </BarPopover>
      {properties ? (
        <BarPopover label="Properties" icon={<MoreHorizontal className="size-4" />} wide>
          {properties}
        </BarPopover>
      ) : null}
      <span className="vault-board-bar-divider" aria-hidden="true" />
      <button
        type="button"
        onClick={onToggleSource}
        aria-pressed={sourceOpen}
        aria-label={sourceOpen ? "Hide Markdown" : "Show Markdown"}
        title={sourceOpen ? "Hide Markdown" : "Show Markdown"}
        className="vault-board-panel-toggle"
      >
        {sourceOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        <span>Markdown</span>
      </button>
      {progress.total > 0 ? (
        // Phones: the progress as a hairline under the header.
        <span className="vault-board-bar-progress" aria-hidden="true">
          <i style={{ width: share(progress.done), background: "var(--board-done)" }} />
          <i style={{ width: share(progress.doing), background: "var(--board-doing)" }} />
        </span>
      ) : null}
    </div>
  );
}

function BarPopover({
  label,
  icon,
  wide,
  className,
  children,
}: {
  label: string;
  icon: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={cn("vault-board-icon-btn", className)} aria-label={label} title={label}>
        {icon}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className={cn("vault-board-pop", wide && "vault-board-pop--wide")}>{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
