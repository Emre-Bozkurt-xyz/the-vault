"use client";

import { useRef, type ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  CheckSquare,
  Code2,
  Download,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Info,
  Link2,
  Maximize2,
  PenLine,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import type { MediaFolder } from "@/components/assets/folder-actions";
import {
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
} from "@/components/ui/dropdown-menu";
import { MEDIA_SORTS, MEDIA_VIEWS, type ContextTarget, type MediaSort, type MediaView } from "@/lib/media-library";

/**
 * The library's actions, in one place (docs/26 §7): the right-click menu and
 * the Details panel's "⋯" both render these, so the same item does the same
 * thing wherever it is chosen. The page supplies the behaviour.
 */
export type LibraryMenuActions = {
  view: (asset: AssetLibraryItem) => void;
  share: (target: { kind: "asset" | "folder"; id: string; name: string }) => void;
  download: (asset: AssetLibraryItem) => void;
  copyLink: (asset: AssetLibraryItem) => void;
  copyEmbed: (asset: AssetLibraryItem) => void;
  renameAsset: (asset: AssetLibraryItem) => void;
  renameFolder: (folder: MediaFolder) => void;
  move: (items: { assetIds: string[]; folderIds: string[] }) => void;
  bin: (items: { assetIds: string[]; folderIds: string[] }) => void;
  openFolder: (folderId: string | null) => void;
  /** Shown while a search spans folders. */
  showInFolder?: (asset: AssetLibraryItem) => void;
  showDetails: () => void;
  newFolder: () => void;
  uploadFiles: () => void;
  uploadFolder: () => void;
  selectAll: () => void;
  clearSelection: () => void;
};

export const VIEW_LABELS: Record<MediaView, string> = {
  masonry: "Masonry",
  grid: "Grid",
  list: "List",
  details: "Details",
};

export const SORT_LABELS: Record<MediaSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  taken: "Date taken",
  name: "Name",
  size: "Largest",
};

export function AssetMenuItems({
  asset,
  actions,
  inPanel = false,
}: {
  asset: AssetLibraryItem;
  actions: LibraryMenuActions;
  /** The panel already shows the details. */
  inPanel?: boolean;
}) {
  const one = { assetIds: [asset.id], folderIds: [] };
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => actions.view(asset)}>
          <Maximize2 /> View <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.share({ kind: "asset", id: asset.id, name: asset.displayName })}>
          <Share2 /> Share…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.download(asset)}>
          <Download /> Download
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.copyEmbed(asset)}>
          <Code2 /> Copy embed
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.copyLink(asset)}>
          <Link2 /> Copy link
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => actions.renameAsset(asset)}>
          <PenLine /> Rename <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.move(one)}>
          <FolderInput /> Move to…
        </DropdownMenuItem>
        {actions.showInFolder ? (
          <DropdownMenuItem onClick={() => actions.showInFolder?.(asset)}>
            <FolderOpen /> Show in folder
          </DropdownMenuItem>
        ) : null}
        {inPanel ? null : (
          <DropdownMenuItem onClick={actions.showDetails}>
            <Info /> Details <DropdownMenuShortcut>I</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" onClick={() => actions.bin(one)}>
          <Trash2 /> Move to Bin <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FolderMenuItems({
  folder,
  actions,
  inPanel = false,
  current = false,
}: {
  folder: MediaFolder;
  actions: LibraryMenuActions;
  inPanel?: boolean;
  /** The folder the page is showing: no "Open". */
  current?: boolean;
}) {
  const one = { assetIds: [], folderIds: [folder.id] };
  return (
    <>
      <DropdownMenuGroup>
        {current ? null : (
          <DropdownMenuItem onClick={() => actions.openFolder(folder.id)}>
            <FolderOpen /> Open <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => actions.share({ kind: "folder", id: folder.id, name: folder.name })}>
          <Share2 /> Share…
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => actions.renameFolder(folder)}>
          <PenLine /> Rename {current ? null : <DropdownMenuShortcut>F2</DropdownMenuShortcut>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.move(one)}>
          <FolderInput /> Move to…
        </DropdownMenuItem>
        {inPanel || current ? null : (
          <DropdownMenuItem onClick={actions.showDetails}>
            <Info /> Details <DropdownMenuShortcut>I</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" onClick={() => actions.bin(one)}>
          <Trash2 /> Move to Bin {current ? null : <DropdownMenuShortcut>Del</DropdownMenuShortcut>}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function SelectionMenuItems({
  assetIds,
  folderIds,
  actions,
}: {
  assetIds: string[];
  folderIds: string[];
  actions: LibraryMenuActions;
}) {
  const count = assetIds.length + folderIds.length;
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{count} items selected</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => actions.move({ assetIds, folderIds })}>
          <FolderInput /> Move to…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.showDetails}>
          <Info /> Details <DropdownMenuShortcut>I</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" onClick={() => actions.bin({ assetIds, folderIds })}>
          <Trash2 /> Move {count} to Bin <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.clearSelection}>
          <X /> Clear selection <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function PlaceMenuItems({
  actions,
  canAdd,
  view,
  onViewChange,
  sort,
  onSortChange,
}: {
  actions: LibraryMenuActions;
  /** False where nothing can be created (the Shared place, a missing folder). */
  canAdd: boolean;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
}) {
  return (
    <>
      {canAdd ? (
        <>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={actions.newFolder}>
              <FolderPlus /> New folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.uploadFiles}>
              <Upload /> Upload files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.uploadFolder}>
              <FolderUp /> Upload folder
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={actions.selectAll}>
          <CheckSquare /> Select all <DropdownMenuShortcut>Ctrl A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            <DropdownMenuRadioGroup value={view} onValueChange={(value) => onViewChange(value as MediaView)}>
              {MEDIA_VIEWS.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {VIEW_LABELS[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sort by</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as MediaSort)}>
              {MEDIA_SORTS.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {SORT_LABELS[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  );
}

/**
 * One context menu for the whole gallery. A right-click (or long-press, or
 * the keyboard's menu key / Shift+F10 on a focused item) reports what it
 * landed on through `onTarget`, synchronously, before the menu renders, so
 * `children` of the popup can follow it.
 */
export function LibraryContextMenu({
  onTarget,
  menu,
  children,
  className,
}: {
  onTarget: (clicked: { kind: "asset" | "folder"; id: string } | null) => void;
  /** The popup's items for the current target. */
  menu: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // When the menu key was last pressed: its contextmenu event follows shortly.
  const menuKeyAt = useRef(0);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className={className}
        onKeyDownCapture={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            menuKeyAt.current = Date.now();
          }
        }}
        onContextMenu={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          // Right-clicks in a text field keep the browser's menu (paste, spelling).
          if (target?.closest("input, textarea, [contenteditable='true']")) {
            event.preventBaseUIHandler();
            return;
          }
          const item = target?.closest<HTMLElement>("[data-asset-id], [data-folder-id]") ?? null;

          // A keyboard-opened menu has no pointer position (or 0,0): replay it
          // at the focused item, so the menu opens beside it, not the corner.
          const keyboard =
            Date.now() - menuKeyAt.current < 1000 || (event.clientX === 0 && event.clientY === 0);
          menuKeyAt.current = 0;
          if (keyboard && target) {
            event.preventDefault();
            event.preventBaseUIHandler();
            const rect = (item ?? target).getBoundingClientRect();
            target.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: Math.round(rect.left + Math.min(24, rect.width / 2)),
                clientY: Math.round(rect.top + Math.min(24, rect.height / 2)),
              }),
            );
            return;
          }

          onTarget(
            item?.dataset.assetId
              ? { kind: "asset", id: item.dataset.assetId }
              : item?.dataset.folderId
                ? { kind: "folder", id: item.dataset.folderId }
                : null,
          );
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <DropdownMenuContent className="min-w-52">{menu}</DropdownMenuContent>
    </ContextMenu.Root>
  );
}

export type { ContextTarget };
