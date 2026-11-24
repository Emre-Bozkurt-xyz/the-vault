"use client";

import { Fragment, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  ChevronRight,
  Folder,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  PenLine,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WithContextMenu } from "@/components/ui/use-context-menu";
import { cn } from "@/lib/utils";

/**
 * Drag and drop inside the media library. Cards and folder tiles carry a
 * private type, so a drag never confuses Vault items with files from the OS;
 * folder tiles and breadcrumbs accept both (items move, files upload there).
 */
export const MEDIA_DRAG_TYPE = "application/x-vault-media";

export type MediaDragPayload = { assetIds: string[]; folderIds: string[] };

export function startMediaDrag(event: DragEvent, payload: MediaDragPayload) {
  event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "move";
}

export function isMediaDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes(MEDIA_DRAG_TYPE);
}

export function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function readMediaDrag(event: DragEvent): MediaDragPayload | null {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(MEDIA_DRAG_TYPE)) as Partial<MediaDragPayload>;
    return {
      assetIds: Array.isArray(parsed.assetIds) ? parsed.assetIds.filter((id) => typeof id === "string") : [],
      folderIds: Array.isArray(parsed.folderIds) ? parsed.folderIds.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return null;
  }
}

/**
 * Drop-target wiring with an enter/leave counter (children fire their own
 * enter/leave events, which would otherwise flicker the highlight).
 */
export function useDropTarget(handlers: {
  onItems?: (payload: MediaDragPayload) => void;
  onFiles?: (dataTransfer: DataTransfer) => void;
}) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const accepts = (event: DragEvent) =>
    (handlers.onItems !== undefined && isMediaDrag(event)) ||
    (handlers.onFiles !== undefined && isFileDrag(event));

  return {
    active,
    props: {
      onDragEnter: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current += 1;
        setActive(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = isMediaDrag(event) ? "move" : "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (!accepts(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      },
      onDrop: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setActive(false);
        if (isMediaDrag(event)) {
          const payload = readMediaDrag(event);
          if (payload && payload.assetIds.length + payload.folderIds.length > 0) handlers.onItems?.(payload);
        } else {
          handlers.onFiles?.(event.dataTransfer);
        }
      },
    },
  };
}

export type FolderTileData = {
  id: string;
  name: string;
  /** Items directly inside: files and subfolders. */
  files: number;
  folders: number;
};

/**
 * A folder in the library grid: click to open, drag to move, drop items or
 * files onto it, "…"/right-click for Rename, Move to…, Move to Bin.
 */
export function FolderTile({
  folder,
  onOpen,
  onRename,
  onMove,
  onBin,
  onDropItems,
  onDropFiles,
}: {
  folder: FolderTileData;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onBin: () => void;
  onDropItems: (payload: MediaDragPayload) => void;
  onDropFiles: (dataTransfer: DataTransfer) => void;
}) {
  const drop = useDropTarget({
    onItems: (payload) => {
      // Dropping a folder onto itself is a no-op, not an error.
      const folderIds = payload.folderIds.filter((id) => id !== folder.id);
      if (folderIds.length + payload.assetIds.length > 0) onDropItems({ ...payload, folderIds });
    },
    onFiles: onDropFiles,
  });
  const summary = [
    folder.folders > 0 ? `${folder.folders} ${folder.folders === 1 ? "folder" : "folders"}` : null,
    `${folder.files} ${folder.files === 1 ? "file" : "files"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <WithContextMenu>
      {(menu) => (
        <div
          data-folder-tile
          onContextMenu={menu.onContextMenu}
          className="group relative"
          {...drop.props}
        >
          <button
            type="button"
            draggable
            onDragStart={(event) => startMediaDrag(event, { assetIds: [], folderIds: [folder.id] })}
            onClick={onOpen}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 pr-11 text-left shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              drop.active ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border/70",
            )}
          >
            {drop.active ? (
              <FolderOpen className="size-5 shrink-0 text-primary" />
            ) : (
              <Folder className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{folder.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {drop.active ? "Drop to move here" : summary}
              </span>
            </span>
          </button>
          <DropdownMenu {...menu.rootProps}>
            <DropdownMenuTrigger
              ref={menu.triggerRef}
              aria-label={`Actions for folder ${folder.name}`}
              onClick={(event) => event.stopPropagation()}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44" {...menu.contentProps}>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onOpen}>
                  <FolderOpen /> Open
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRename}>
                  <PenLine /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMove}>
                  <FolderInput /> Move to…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={onBin}>
                  <Trash2 /> Move to Bin
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </WithContextMenu>
  );
}

/**
 * "Content › Events › Lisbon": every crumb but the current one is a link and a
 * drop target, so items can be dragged up the tree.
 */
export function FolderBreadcrumbs({
  rootLabel,
  trail,
  onNavigate,
  onDropItems,
}: {
  rootLabel: string;
  trail: { id: string; name: string }[];
  onNavigate: (folderId: string | null) => void;
  onDropItems: (payload: MediaDragPayload, targetId: string | null, targetName: string) => void;
}) {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: rootLabel }, ...trail];

  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-0.5">
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.id ?? "root"}>
          {index > 0 ? (
            <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          ) : null}
          {index === crumbs.length - 1 ? (
            <span className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-foreground/80">
              {crumb.name}
            </span>
          ) : (
            <Crumb
              name={crumb.name}
              onClick={() => onNavigate(crumb.id)}
              onDropItems={(payload) => onDropItems(payload, crumb.id, crumb.name)}
            />
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function Crumb({
  name,
  onClick,
  onDropItems,
}: {
  name: string;
  onClick: () => void;
  onDropItems: (payload: MediaDragPayload) => void;
}): ReactNode {
  const drop = useDropTarget({ onItems: onDropItems });

  return (
    <button
      type="button"
      onClick={onClick}
      {...drop.props}
      className={cn(
        "truncate rounded px-1 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground transition hover:text-foreground",
        drop.active && "bg-primary/15 text-foreground ring-1 ring-primary/50",
      )}
    >
      {name}
    </button>
  );
}
