"use client";

import { useRef, type ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  CheckSquare,
  CircleCheck,
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
  /** Enter selection mode with this item selected (also a touch long-press). */
  select: (item: { kind: "asset" | "folder"; id: string }) => void;
  /** Enter selection mode with nothing selected yet: taps then pick items. */
  startSelecting: () => void;
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
        {inPanel ? null : (
          <DropdownMenuItem onClick={() => actions.select({ kind: "asset", id: asset.id })}>
            <CircleCheck /> Select
          </DropdownMenuItem>
        )}
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
        {current || inPanel ? null : (
          <DropdownMenuItem onClick={() => actions.select({ kind: "folder", id: folder.id })}>
            <CircleCheck /> Select
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
        <DropdownMenuItem onClick={actions.selectAll}>
          <CheckSquare /> Select all <DropdownMenuShortcut>Ctrl A</DropdownMenuShortcut>
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
        <DropdownMenuItem onClick={actions.startSelecting}>
          <CircleCheck /> Select items
        </DropdownMenuItem>
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

/** How long a finger must rest on an item to select it (the menu's own delay). */
const LONG_PRESS_MS = 500;
/** Finger travel that turns a press into a scroll. */
const LONG_PRESS_SLOP = 10;

type Clicked = { kind: "asset" | "folder"; id: string };

function itemAt(target: EventTarget | null): Clicked | null {
  const element = target instanceof Element ? target : null;
  const item = element?.closest<HTMLElement>("[data-asset-id], [data-folder-id]") ?? null;
  if (item?.dataset.assetId) return { kind: "asset", id: item.dataset.assetId };
  if (item?.dataset.folderId) return { kind: "folder", id: item.dataset.folderId };
  return null;
}

/**
 * One context menu for the whole gallery. A right-click (or the keyboard's
 * menu key / Shift+F10 on a focused item, or a long-press on empty space)
 * reports what it landed on through `onTarget`, synchronously, before the
 * menu renders, so `children` of the popup can follow it.
 *
 * On touch, a long-press on an item doesn't open the menu: it goes to
 * `onItemLongPress` (select it, like a phone gallery), and the click that
 * follows the finger lifting is swallowed so it doesn't also open the item.
 */
export function LibraryContextMenu({
  onTarget,
  onItemLongPress,
  menu,
  children,
  className,
}: {
  onTarget: (clicked: Clicked | null) => void;
  onItemLongPress?: (clicked: Clicked) => void;
  /** The popup's items for the current target. */
  menu: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // When the menu key was last pressed: its contextmenu event follows shortly.
  const menuKeyAt = useRef(0);
  // What the last touch landed on: a touch long-press opens the menu without
  // a contextmenu event to read it from.
  const touched = useRef<Clicked | null>(null);
  // An item long-press in progress, and whether one just fired.
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const claimed = useRef(false);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        if (open && details.event?.type.startsWith("touch")) onTarget(touched.current);
      }}
    >
      <ContextMenu.Trigger
        className={className}
        onTouchStart={(event) => {
          const clicked = itemAt(event.target);
          touched.current = clicked;
          claimed.current = false;
          cancelPress();
          if (!clicked || !onItemLongPress || event.touches.length !== 1) return;
          // Ours, not the menu's: a long-press on an item selects it.
          event.preventBaseUIHandler();
          const touch = event.touches[0];
          press.current = {
            x: touch.clientX,
            y: touch.clientY,
            timer: window.setTimeout(() => {
              press.current = null;
              claimed.current = true;
              onItemLongPress(clicked);
            }, LONG_PRESS_MS),
          };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (
            press.current &&
            touch &&
            (Math.abs(touch.clientX - press.current.x) > LONG_PRESS_SLOP ||
              Math.abs(touch.clientY - press.current.y) > LONG_PRESS_SLOP)
          ) {
            cancelPress();
          }
        }}
        onTouchEnd={() => {
          cancelPress();
          // The click this lift produces belongs to the long-press; let it be
          // swallowed, then forget.
          if (claimed.current) window.setTimeout(() => (claimed.current = false), 400);
        }}
        onTouchCancel={cancelPress}
        onClickCapture={(event) => {
          if (!claimed.current) return;
          claimed.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            menuKeyAt.current = Date.now();
          }
        }}
        onContextMenu={(event) => {
          // Android also fires contextmenu on a long-press: not for items we select.
          if (press.current || claimed.current) {
            event.preventDefault();
            event.preventBaseUIHandler();
            return;
          }
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

          onTarget(itemAt(target));
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <DropdownMenuContent className="min-w-52">{menu}</DropdownMenuContent>
    </ContextMenu.Root>
  );
}

export type { ContextTarget };
