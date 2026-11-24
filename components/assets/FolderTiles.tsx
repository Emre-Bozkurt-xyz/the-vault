"use client";

import {
  Fragment,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, ChevronRight, Folder, FolderOpen, Link2 } from "lucide-react";

import { RenditionImage } from "@/components/assets/RenditionImage";
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
 * Wiring every folder item shares with the page (docs/26 §7): click selects
 * (with modifiers), double-click/Enter opens, drag moves, and Vault items or
 * OS files dropped on it move or upload into it.
 */
export type FolderItemHandlers = {
  selectedFolderIds: ReadonlySet<string>;
  /** Folders with a working share link (link badge). */
  sharedFolderIds?: ReadonlySet<string>;
  /** Newest thumbnails inside each folder, for the card's preview. */
  previews?: ReadonlyMap<string, string[]>;
  /** While selecting several, every item shows its tick circle. */
  selecting: boolean;
  onFolderClick: (folder: FolderTileData, event: MouseEvent) => void;
  onFolderToggle: (folder: FolderTileData) => void;
  onFolderOpen: (folder: FolderTileData) => void;
  onFolderDragStart: (folder: FolderTileData, event: DragEvent) => void;
  onFolderDropItems: (folder: FolderTileData, payload: MediaDragPayload) => void;
  onFolderDropFiles: (folder: FolderTileData, dataTransfer: DataTransfer) => void;
};

export function folderSummary(folder: Pick<FolderTileData, "files" | "folders">) {
  if (folder.files === 0 && folder.folders === 0) return "Empty";
  return [
    folder.folders > 0 ? `${folder.folders} ${folder.folders === 1 ? "folder" : "folders"}` : null,
    folder.files > 0 ? `${folder.files} ${folder.files === 1 ? "file" : "files"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function useFolderItem(folder: FolderTileData, handlers: FolderItemHandlers) {
  const drop = useDropTarget({
    onItems: (payload) => {
      // Dropping a folder onto itself is a no-op, not an error.
      const folderIds = payload.folderIds.filter((id) => id !== folder.id);
      if (folderIds.length + payload.assetIds.length > 0) {
        handlers.onFolderDropItems(folder, { ...payload, folderIds });
      }
    },
    onFiles: (dataTransfer) => handlers.onFolderDropFiles(folder, dataTransfer),
  });
  const selected = handlers.selectedFolderIds.has(folder.id);

  return {
    drop,
    selected,
    shared: handlers.sharedFolderIds?.has(folder.id) ?? false,
    wrapperProps: {
      "data-folder-tile": "",
      "data-folder-id": folder.id,
      ...drop.props,
    },
    buttonProps: {
      type: "button" as const,
      draggable: true,
      "aria-pressed": selected,
      "aria-label": `Folder ${folder.name}, ${folderSummary(folder).toLowerCase()}`,
      onDragStart: (event: DragEvent) => handlers.onFolderDragStart(folder, event),
      onClick: (event: MouseEvent) => handlers.onFolderClick(folder, event),
      onDoubleClick: () => handlers.onFolderOpen(folder),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          handlers.onFolderOpen(folder);
        }
      },
    },
  };
}

function FolderSelectCircle({
  folder,
  selected,
  handlers,
  className,
}: {
  folder: FolderTileData;
  selected: boolean;
  handlers: FolderItemHandlers;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? `Deselect folder ${folder.name}` : `Select folder ${folder.name}`}
      onClick={(event) => {
        event.stopPropagation();
        handlers.onFolderToggle(folder);
      }}
      className={cn(
        "grid size-6 place-items-center rounded-full border shadow-sm backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected
          ? "border-primary bg-primary text-primary-foreground opacity-100"
          : cn(
              "border-white/80 bg-black/25 text-transparent hover:bg-black/40",
              handlers.selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            ),
        className,
      )}
    >
      <Check className="size-3.5" />
    </button>
  );
}

/**
 * A folder in the photo views: a square card previewing what is inside. In
 * the grid it sits in the same columns as the photos; with `fill` (the
 * mosaic) it fills the square box the row gives it, with the mosaic's corners.
 */
export function FolderCard({
  folder,
  handlers,
  fill = false,
}: {
  folder: FolderTileData;
  handlers: FolderItemHandlers;
  fill?: boolean;
}) {
  const item = useFolderItem(folder, handlers);
  const previews = handlers.previews?.get(folder.id) ?? [];

  return (
    <div {...item.wrapperProps} className={cn("group relative", fill && "size-full")}>
      <button
        {...item.buttonProps}
        className={cn(
          "relative block overflow-hidden border bg-muted/50 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          fill ? "size-full rounded-[3px]" : "aspect-square w-full rounded-md",
          item.drop.active
            ? "border-primary ring-2 ring-primary/50"
            : item.selected
              ? "border-primary ring-2 ring-primary/45"
              : "border-border/70 hover:border-primary/50",
        )}
      >
        <FolderPreview previews={previews} />
        <span className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-3 pb-2.5 pt-10 text-white">
          {item.drop.active ? (
            <FolderOpen className="mb-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <Folder className="mb-0.5 size-4 shrink-0 fill-white/25" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{folder.name}</span>
            <span className="block truncate text-xs text-white/75">
              {item.drop.active ? "Drop to move here" : folderSummary(folder)}
            </span>
          </span>
        </span>
        {item.selected ? <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/12" /> : null}
      </button>
      <FolderSelectCircle folder={folder} selected={item.selected} handlers={handlers} className="absolute left-2 top-2" />
      {item.shared ? <SharedBadge className="absolute right-2 top-2" /> : null}
    </div>
  );
}

/** Up to four thumbnails from inside the folder, or a folder mark when there are none. */
function FolderPreview({ previews }: { previews: string[] }) {
  if (previews.length === 0) {
    return (
      <span className="grid size-full place-items-center pb-8 text-muted-foreground/60">
        <Folder className="size-14 stroke-[1.25]" aria-hidden />
      </span>
    );
  }
  const shown = previews.length >= 4 ? previews.slice(0, 4) : previews.slice(0, 1);
  return (
    <span className={cn("grid size-full gap-px bg-border/40", shown.length === 4 && "grid-cols-2 grid-rows-2")}>
      {shown.map((src) => (
        <RenditionImage
          key={src}
          src={src}
          alt=""
          className="size-full object-cover"
          fallback={<span className="block size-full bg-muted" />}
        />
      ))}
    </span>
  );
}

/** A folder in the list view: a row above the files. */
export function FolderRow({ folder, handlers }: { folder: FolderTileData; handlers: FolderItemHandlers }) {
  const item = useFolderItem(folder, handlers);

  return (
    <div {...item.wrapperProps} role="listitem" className="group relative">
      <button
        {...item.buttonProps}
        className={cn(
          "flex w-full items-center gap-3 rounded-md border px-2 py-1.5 pl-10 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          item.drop.active
            ? "border-primary bg-primary/10"
            : item.selected
              ? "border-primary/60 bg-primary/10"
              : "border-transparent hover:border-border/70 hover:bg-muted/50",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
          {item.drop.active ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
        {item.shared ? <Link2 className="size-3.5 shrink-0 text-primary" aria-label="Shared by link" /> : null}
        <span className="w-36 shrink-0 truncate text-right text-xs text-muted-foreground">
          {item.drop.active ? "Drop to move here" : folderSummary(folder)}
        </span>
      </button>
      <FolderSelectCircle
        folder={folder}
        selected={item.selected}
        handlers={handlers}
        className="absolute left-2 top-1/2 -translate-y-1/2 border-border bg-background/80"
      />
    </div>
  );
}

/** A folder in the details table; `columns` is how many cells follow the name. */
export function FolderTableRow({
  folder,
  handlers,
  columns,
}: {
  folder: FolderTileData;
  handlers: FolderItemHandlers;
  columns: number;
}) {
  const item = useFolderItem(folder, handlers);

  return (
    <tr
      {...item.wrapperProps}
      className={cn(
        "group border-b border-border/50",
        item.drop.active || item.selected ? "bg-primary/10" : "hover:bg-muted/40",
      )}
    >
      <td className="px-2 py-1.5">
        <FolderSelectCircle folder={folder} selected={item.selected} handlers={handlers} className="border-border bg-background/80" />
      </td>
      <td className="max-w-0 py-1.5 pr-3">
        <button
          {...item.buttonProps}
          className="flex w-full min-w-0 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
            <Folder className="size-4" />
          </span>
          <span className="truncate font-medium">{folder.name}</span>
          {item.shared ? <Link2 className="size-3.5 shrink-0 text-primary" aria-label="Shared by link" /> : null}
        </button>
      </td>
      <td colSpan={columns} className="py-1.5 pr-3 text-xs text-muted-foreground">
        {item.drop.active ? "Drop to move here" : `Folder · ${folderSummary(folder)}`}
      </td>
    </tr>
  );
}

/** The mark on shared items, readable over any photo. */
export function SharedBadge({
  className,
  label = "Shared by link",
  icon: Icon = Link2,
}: {
  className?: string;
  label?: string;
  icon?: typeof Link2;
}) {
  return (
    <span
      title={label}
      className={cn(
        "pointer-events-none grid size-6 place-items-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The page title: "All files › Events › Lisbon". Ancestors are links and drop
 * targets, so items can be dragged up the tree; the current folder is the
 * heading itself. Deep trails fold the middle away.
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
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-0.5">
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.id ?? "root"}>
          {index > 0 ? (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
          ) : null}
          {index === crumbs.length - 1 ? (
            <h1 className="min-w-0 truncate px-1 text-xl font-semibold tracking-tight" aria-current="page">
              {crumb.name}
            </h1>
          ) : (
            <Crumb
              name={crumb.name}
              folded={index > 0 && index < crumbs.length - 3}
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
  folded,
  onClick,
  onDropItems,
}: {
  name: string;
  folded: boolean;
  onClick: () => void;
  onDropItems: (payload: MediaDragPayload) => void;
}): ReactNode {
  const drop = useDropTarget({ onItems: onDropItems });

  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      aria-label={folded ? name : undefined}
      {...drop.props}
      className={cn(
        "min-w-0 max-w-[12rem] shrink truncate rounded px-1 py-0.5 text-xl font-semibold tracking-tight text-muted-foreground transition hover:text-foreground",
        drop.active && "bg-primary/15 text-foreground ring-1 ring-primary/50",
      )}
    >
      {folded ? "…" : name}
    </button>
  );
}
