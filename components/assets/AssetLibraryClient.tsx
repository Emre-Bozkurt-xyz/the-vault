"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  CheckSquare,
  FolderInput,
  FolderOpen,
  FolderX,
  ImageIcon,
  Link2,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { AssetDetails, FolderDetails, SelectionDetails } from "@/components/assets/AssetDetailsPanel";
import {
  AssetUsageList,
  fetchAssetUsage,
  usageDocumentCount,
  type AssetUsage,
} from "@/components/assets/AssetUsage";
import { FolderNameDialog, MoveToFolderDialog, type MoveSelection } from "@/components/assets/FolderDialogs";
import {
  FolderBreadcrumbs,
  isFileDrag,
  isMediaDrag,
  startMediaDrag,
  type FolderItemHandlers,
  type FolderTileData,
  type MediaDragPayload,
} from "@/components/assets/FolderTiles";
import {
  AssetMenuItems,
  FolderMenuItems,
  LibraryContextMenu,
  PlaceMenuItems,
  SelectionMenuItems,
  type LibraryMenuActions,
} from "@/components/assets/LibraryMenus";
import { LibraryShortcutsDialog } from "@/components/assets/LibraryShortcutsDialog";
import { KIND_LABELS, LibraryToolbar, NewFloatingButton, type KindFilter } from "@/components/assets/LibraryToolbar";
import { MediaItemView } from "@/components/assets/MediaItemViews";
import { MediaViewer } from "@/components/assets/MediaViewer";
import { ShareLinkDialog, type ShareTarget } from "@/components/assets/ShareLinkDialog";
import { UploadTray } from "@/components/assets/UploadTray";
import { moveAssetsToBin } from "@/components/assets/asset-bin-actions";
import { absoluteAssetUrl, copyWithToast, downloadAsset } from "@/components/assets/asset-ui";
import {
  binMediaItems,
  createMediaFolder,
  moveFolderToBin,
  moveMediaItems,
  renameMediaFolder,
  type MediaFolder,
} from "@/components/assets/folder-actions";
import { collectDroppedFiles, filesFromDirectoryInput, uploadDroppedTree } from "@/components/assets/folder-drop";
import { useAssetUploads } from "@/components/assets/useAssetUploads";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { useMediaQuery } from "@/components/workspace/panel-visibility";
import { useCloseOnBack } from "@/components/ui/use-close-on-back";
import { dispatchAssetsChanged, subscribeToAssetsChanged } from "@/lib/asset-events";
import { childFolders, descendantFolderIds, folderPath } from "@/lib/asset-folders";
import {
  getContentSearchSummary,
  matchesContentSearchQuery,
  parseContentSearchQuery,
} from "@/lib/content-search-query";
import { formatBytes } from "@/lib/format";
import {
  EMPTY_SELECTION,
  applySelectionClick,
  folderPreviewThumbs,
  parseLibraryPlace,
  pruneSelection,
  resolveContextTarget,
  selectAll,
  selectionMode,
  selectionSize,
  sortMediaAssets,
  type ContextTarget,
  type MediaLibraryPrefs,
  type MediaSelection,
  type MediaSort,
  type MediaView,
} from "@/lib/media-library";
import { fetchAssetLibrary } from "@/lib/shared-request";
import { cn } from "@/lib/utils";
import { attachVideoPoster, requestServerPoster } from "@/lib/video-poster";
import { setMediaLibraryViewAction } from "@/server/user-settings-actions";

export type AssetLibraryItem = {
  id: string;
  /** Media library folder; null = the library root. */
  folderId: string | null;
  kind: "image" | "pdf" | "video" | "file";
  displayName: string;
  description: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
  createdAt: Date | string;
  tags: string[];
  /** The original. Open, download and copy-link use it; grids never do. */
  url: string;
  /** Grid-sized WebP (`?r=thumb`), or null when the asset has no renditions. */
  thumbUrl: string | null;
  /** Panel/viewer-sized WebP (`?r=display`), or null likewise. */
  displayUrl: string | null;
  /** Displayed pixel size, once known (filled when renditions are made). */
  width: number | null;
  height: number | null;
  /** EXIF date taken (camera wall clock stored as UTC), once known. */
  takenAt: Date | string | null;
  /** Video length, once the uploader's browser measured it. */
  durationMs?: number | null;
  markdown: string;
};

type VisibilityFilter = "all" | "private" | "public";
type NameDialog =
  | { mode: "create" }
  | { mode: "rename"; folder: MediaFolder }
  | { mode: "rename-asset"; asset: AssetLibraryItem };
type Items = { assetIds: string[]; folderIds: string[] };

const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm";
const ASSETS_PAGE = { type: "assets", title: "Assets", href: "/assets" } as const;
const ROOT_LABEL = "All files";
/** Per-viewer: whether Details was left open (desktop only). */
const DETAILS_KEY = "vault:asset-library:details";

/**
 * The media library (docs/26 §7). One job per area: the left panel is where
 * you are, the toolbar is how you're looking, the right-click menu (and the
 * Details "⋯") is what you can do, and Details shows on request.
 */
export function AssetLibraryClient({
  initialAssets,
  initialFolders,
  initialPrefs,
  initialShared,
  storageUsedBytes,
  storageQuotaBytes,
  unrestrictedUploads = false,
}: {
  initialAssets: AssetLibraryItem[];
  initialFolders: MediaFolder[];
  /** Saved per user (`files-assets/media-library`). */
  initialPrefs: MediaLibraryPrefs;
  /** Folders and files with a working share link. */
  initialShared: { folderIds: string[]; assetIds: string[] };
  /** Tracked quota use (includes the Bin, which still occupies storage). */
  storageUsedBytes: number;
  storageQuotaBytes: number;
  /** Admin grant: the picker offers every file type, not just media. */
  unrestrictedUploads?: boolean;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [folders, setFolders] = useState(initialFolders);
  const [usedBytes, setUsedBytes] = useState(storageUsedBytes);
  const [view, setView] = useState(initialPrefs.view);
  const [showNames, setShowNames] = useState(initialPrefs.showNames);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // The place, folder, filters, the single selected asset and the viewer live
  // in the URL, so links and Back work (`?view=shared`, `?folder=`, `?kind=`,
  // `?asset=`, `?open=`). Search, sort and multi-selection stay local.
  const searchParams = useSearchParams();
  const place = parseLibraryPlace(searchParams.get("view"));
  const kindFilter = parseKindFilter(searchParams.get("kind"));
  const visibilityFilter = parseVisibilityFilter(searchParams.get("visibility"));
  const urlAssetId = searchParams.get("asset");
  const openId = searchParams.get("open");
  const requestedFolderId = place === "files" ? searchParams.get("folder") : null;
  const currentFolder = folders.find((folder) => folder.id === requestedFolderId) ?? null;
  const currentFolderId = currentFolder?.id ?? null;
  const missingFolder = requestedFolderId !== null && currentFolder === null;
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<MediaSort>("newest");
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [moveSelection, setMoveSelection] = useState<MoveSelection | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shared, setShared] = useState(initialShared);
  const sharedFolderIds = useMemo(() => new Set(shared.folderIds), [shared]);
  const sharedAssetIds = useMemo(() => new Set(shared.assetIds), [shared]);
  const [fileDropActive, setFileDropActive] = useState(false);
  const fileDropDepth = useRef(0);
  // Whether this page pushed the viewer's history entry (then closing goes Back).
  const viewerPushed = useRef(false);
  const healedPosters = useRef(new Set<string>());
  const [menuTarget, setMenuTarget] = useState<ContextTarget>({ kind: "background" });

  // Selection: a link can select one asset through `?asset=`; clicks here
  // change it directly. A URL value is adopted (during render, React's
  // "derive from props" pattern) only when it *changes* to an id the
  // selection doesn't already say. Comparing against our own last write
  // instead would misfire: `useSearchParams` catches up with `replaceState` a
  // render late, so a stale value would re-select one item and wipe a
  // Ctrl-click.
  const [selection, setSelection] = useState<MediaSelection>(() =>
    urlAssetId ? { assetIds: [urlAssetId], folderIds: [], anchor: urlAssetId } : EMPTY_SELECTION,
  );
  // Ticking a circle or Ctrl/Shift-clicking starts "selecting": every item
  // shows its circle and the selection bar appears. A plain click only
  // highlights one item.
  const [ticking, setTicking] = useState(false);
  // Selection mode entered on purpose (a touch long-press, "Select items"):
  // stays on, even with nothing ticked, until it is closed.
  const [selectMode, setSelectMode] = useState(false);
  const coarsePointer = useMediaQuery("(pointer: coarse)", false);
  const [seenUrlAsset, setSeenUrlAsset] = useState(urlAssetId);
  if (urlAssetId !== seenUrlAsset) {
    setSeenUrlAsset(urlAssetId);
    const alreadySelected =
      selection.assetIds.length === 1 &&
      selection.folderIds.length === 0 &&
      selection.assetIds[0] === urlAssetId;
    if (urlAssetId && !alreadySelected) {
      setSelection({ assetIds: [urlAssetId], folderIds: [], anchor: urlAssetId });
      setTicking(false);
    }
  }

  // Details: the workspace's right panel, registered only while open (it is
  // this page's toggle, not the shared collapsible panel). The page portals
  // its content into an empty host there, so drafts stay here.
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    // Past hydration, so server and client markup match.
    const frame = window.requestAnimationFrame(() => {
      try {
        if (
          window.localStorage.getItem(DETAILS_KEY) === "1" &&
          window.matchMedia("(min-width: 1024px)").matches
        ) {
          setDetailsOpen(true);
        }
      } catch {
        // Storage blocked: start closed.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const changeDetails = useCallback((open: boolean) => {
    setDetailsOpen(open);
    try {
      window.localStorage.setItem(DETAILS_KEY, open ? "1" : "0");
    } catch {
      // Not remembered; fine.
    }
  }, []);
  const closeDetails = useCallback(() => changeDetails(false), [changeDetails]);
  const [panelHosts, setPanelHosts] = useState<HTMLElement[]>([]);
  const panelHostRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setPanelHosts((current) => [...current, node]);
    return () => setPanelHosts((current) => current.filter((host) => host !== node));
  }, []);
  const panelSlot = useMemo(
    () => <div ref={panelHostRef} className="flex min-h-full flex-col" />,
    [panelHostRef],
  );
  const panelHost = panelHosts.at(-1) ?? null;

  const parsedQuery = useMemo(() => parseContentSearchQuery(query), [query]);
  const querySummary = useMemo(() => getContentSearchSummary(parsedQuery), [parsedQuery]);
  const uploads = useAssetUploads({
    // Refreshes this page and the side panel alike.
    onSettled: () => dispatchAssetsChanged(),
    autoDismissMs: 4000,
  });

  // Searching or filtering looks across every folder, like Drive; otherwise
  // the page shows one place: a folder's subfolders, then its files.
  const searching = query.trim().length > 0 || kindFilter !== "all" || visibilityFilter !== "all";
  const canAdd = place === "files" && !missingFolder;
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const breadcrumbs = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId]);
  const previews = useMemo(() => folderPreviewThumbs(assets), [assets]);
  const directCounts = useMemo(() => {
    const files = new Map<string, number>();
    const subfolders = new Map<string, number>();
    for (const asset of assets) {
      if (asset.folderId) files.set(asset.folderId, (files.get(asset.folderId) ?? 0) + 1);
    }
    for (const folder of folders) {
      if (folder.parentId) subfolders.set(folder.parentId, (subfolders.get(folder.parentId) ?? 0) + 1);
    }
    return { files, subfolders };
  }, [assets, folders]);
  const tileFor = useCallback(
    (folder: MediaFolder): FolderTileData => ({
      id: folder.id,
      name: folder.name,
      files: directCounts.files.get(folder.id) ?? 0,
      folders: directCounts.subfolders.get(folder.id) ?? 0,
    }),
    [directCounts],
  );

  const folderTiles = useMemo(() => {
    if (place === "shared") {
      return childFolders(
        folders.filter((folder) => sharedFolderIds.has(folder.id)).map((folder) => ({ ...folder, parentId: null })),
        null,
      ).map(tileFor);
    }
    if (searching) {
      // Folder names match plain search words, when no type filter applies.
      const needle = query.trim().toLowerCase();
      if (!needle || kindFilter !== "all" || visibilityFilter !== "all") return [];
      return childFolders(
        folders.filter((folder) => folder.name.toLowerCase().includes(needle)).map((folder) => ({ ...folder, parentId: null })),
        null,
      ).map(tileFor);
    }
    return childFolders(folders, currentFolderId).map(tileFor);
  }, [currentFolderId, folders, kindFilter, place, query, searching, sharedFolderIds, tileFor, visibilityFilter]);

  const visibleAssets = useMemo(() => {
    const scope =
      place === "shared"
        ? assets.filter((asset) => sharedAssetIds.has(asset.id) || asset.visibility === "public")
        : searching
          ? assets
          : assets.filter((asset) => (asset.folderId ?? null) === currentFolderId);
    return filterAndSortAssets(scope, {
      query: parsedQuery,
      kind: kindFilter,
      visibility: visibilityFilter,
      sort: sortMode,
    });
  }, [assets, currentFolderId, kindFilter, parsedQuery, place, searching, sharedAssetIds, sortMode, visibilityFilter]);
  const visibleAssetIds = useMemo(() => visibleAssets.map((asset) => asset.id), [visibleAssets]);
  const visibleFolderIds = useMemo(() => folderTiles.map((tile) => tile.id), [folderTiles]);
  const spansFolders = searching || place === "shared";

  // Only what is on screen can stay selected (moves, bins, folder changes).
  const liveSelection = useMemo(
    () => pruneSelection(selection, new Set(visibleAssetIds), new Set(visibleFolderIds)),
    [selection, visibleAssetIds, visibleFolderIds],
  );
  const selectedAssetIds = useMemo(() => new Set(liveSelection.assetIds), [liveSelection]);
  const selectedFolderIds = useMemo(() => new Set(liveSelection.folderIds), [liveSelection]);
  const selectedCount = selectionSize(liveSelection);
  const selecting = selectedCount > 1 || (ticking && selectedCount > 0) || selectMode;
  const selected =
    selectedCount === 1 && liveSelection.assetIds.length === 1
      ? (assets.find((asset) => asset.id === liveSelection.assetIds[0]) ?? null)
      : // A deep link may point at an asset in another folder: still show it.
        selectedCount === 0 && urlAssetId
        ? (assets.find((asset) => asset.id === urlAssetId) ?? null)
        : null;
  const selectedFolder =
    selectedCount === 1 && liveSelection.folderIds.length === 1
      ? (folderById.get(liveSelection.folderIds[0]) ?? null)
      : null;

  // The viewer steps through what's on screen, in its order.
  const viewerItems = useMemo(() => {
    if (!openId) return [];
    if (visibleAssetIds.includes(openId)) return visibleAssets;
    const lone = assets.find((asset) => asset.id === openId);
    return lone ? [lone] : [];
  }, [assets, openId, visibleAssetIds, visibleAssets]);
  const viewerIndex = openId ? viewerItems.findIndex((asset) => asset.id === openId) : -1;

  const libraryEmpty = assets.length === 0 && folders.length === 0;
  const locationOf = useCallback(
    (asset: AssetLibraryItem) =>
      asset.folderId ? (folderById.get(asset.folderId)?.name ?? ROOT_LABEL) : ROOT_LABEL,
    [folderById],
  );

  const refreshAssets = useCallback(async () => {
    try {
      const payload = (await fetchAssetLibrary()) as {
        assets?: AssetLibraryItem[];
        folders?: MediaFolder[];
        shared?: { folderIds: string[]; assetIds: string[] };
        storage?: { usedBytes: number };
      } | null;
      if (payload?.assets) setAssets(payload.assets);
      if (payload?.folders) setFolders(payload.folders);
      if (payload?.shared) setShared(payload.shared);
      if (payload?.storage) setUsedBytes(payload.storage.usedBytes);
    } catch {
      // Keep the list we have.
    }
  }, []);

  useEffect(() => subscribeToAssetsChanged(() => void refreshAssets()), [refreshAssets]);

  const clearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
    setTicking(false);
    setSelectMode(false);
    if (new URLSearchParams(window.location.search).has("asset")) {
      updateLibraryUrl({ asset: null });
    }
  }, []);

  // A click on empty page space clears the selection, like a file manager's
  // background click. Items, controls, text selections, and the click that
  // only dismissed an open menu don't count; neither do clicks in the side
  // panels (outside `main`).
  useEffect(() => {
    let menuWasOpen = false;
    const onPointerDown = () => {
      menuWasOpen = document.querySelector('[data-slot="dropdown-menu-content"]') !== null;
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        menuWasOpen ||
        event.button !== 0 ||
        !(target instanceof Element) ||
        !target.closest("main") ||
        target.closest(backgroundClickIgnore) ||
        window.getSelection()?.toString()
      ) {
        return;
      }
      clearSelection();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick);
    };
  }, [clearSelection]);

  const binItems = useCallback(
    async (items: Items) => {
      const binAssets = assets.filter((asset) => items.assetIds.includes(asset.id));
      const binFolders = folders.filter((folder) => items.folderIds.includes(folder.id));
      if (binAssets.length + binFolders.length === 0) return;

      if (binFolders.length === 0) {
        const moved = await moveAssetsToBin(binAssets);
        setAssets((current) => current.filter((asset) => !moved.includes(asset.id)));
      } else if (binAssets.length === 0 && binFolders.length === 1) {
        await moveFolderToBin(binFolders[0]);
      } else {
        await binMediaItems({ assets: binAssets, folders: binFolders });
      }
      clearSelection();
    },
    [assets, clearSelection, folders],
  );

  // Binning something documents embed asks first (they'd show a placeholder).
  // `run` does the binning (the folder on screen also goes up a level).
  const [binWarning, setBinWarning] = useState<{
    items: Items;
    usage: AssetUsage[];
    run: () => Promise<unknown>;
  } | null>(null);
  const requestBin = useCallback(
    async (items: Items, run: () => Promise<unknown> = () => binItems(items)) => {
      const usage = await fetchAssetUsage({ assetIds: items.assetIds, folderIds: items.folderIds });
      if (usageDocumentCount(usage) === 0) {
        await run();
      } else {
        setBinWarning({ items, usage, run });
      }
    },
    [binItems],
  );

  const mergeSaved = useCallback((saved: AssetLibraryItem) => {
    setAssets((current) =>
      current.map((asset) =>
        asset.id === saved.id ? { ...asset, ...saved, folderId: asset.folderId, takenAt: asset.takenAt } : asset,
      ),
    );
    dispatchAssetsChanged();
  }, []);

  /** Saves edits to one asset (rename, gallery listing); throws with the server's message. */
  const patchAsset = useCallback(
    async (asset: AssetLibraryItem, patch: Partial<Pick<AssetLibraryItem, "displayName" | "visibility">>) => {
      const response = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: asset.displayName,
          altText: asset.altText ?? "",
          description: asset.description ?? "",
          visibility: asset.visibility,
          tags: asset.tags,
          ...patch,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        asset?: AssetLibraryItem;
        error?: string;
      } | null;
      if (!response.ok || !payload?.asset) throw new Error(payload?.error ?? "Could not save.");
      mergeSaved(payload.asset);
      return payload.asset;
    },
    [mergeSaved],
  );
  // The Share dialog's gallery switch saves on top of the latest edits.
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  function openViewer(asset: AssetLibraryItem) {
    viewerPushed.current = true;
    updateLibraryUrl({ open: asset.id }, { push: true });
  }

  function closeViewer() {
    if (viewerPushed.current) {
      viewerPushed.current = false;
      window.history.back();
    } else {
      updateLibraryUrl({ open: null });
    }
  }

  /** Opens a folder (null = All files) as a new history entry, so Back goes up again. */
  function openFolder(folderId: string | null) {
    setSelection(EMPTY_SELECTION);
    setTicking(false);
    updateLibraryUrl({ folder: folderId, asset: null, view: null }, { push: true });
  }

  function showInFolder(asset: AssetLibraryItem) {
    setQuery("");
    setSelection({ assetIds: [asset.id], folderIds: [], anchor: asset.id });
    setTicking(false);
    updateLibraryUrl(
      { folder: asset.folderId, asset: asset.id, view: null, kind: null, visibility: null },
      { push: true },
    );
  }

  function itemsFor(items: Items): MoveSelection {
    return {
      assets: assets
        .filter((asset) => items.assetIds.includes(asset.id))
        .map((asset) => ({ id: asset.id, folderId: asset.folderId })),
      folderIds: items.folderIds,
    };
  }

  function share(target: { kind: "asset" | "folder"; id: string; name: string }) {
    if (target.kind === "folder") {
      setShareTarget(target);
      return;
    }
    const asset = assets.find((candidate) => candidate.id === target.id);
    setShareTarget({
      ...target,
      listed: asset?.visibility === "public",
      onListedChange: asset
        ? async (listed) => {
            // Re-read the asset: other edits may have landed since the dialog opened.
            const current = assetsRef.current.find((candidate) => candidate.id === asset.id) ?? asset;
            await patchAsset(current, { visibility: listed ? "public" : "private" });
          }
        : undefined,
    });
  }

  const actions: LibraryMenuActions = {
    view: openViewer,
    share,
    download: downloadAsset,
    copyLink: (asset) => void copyWithToast(absoluteAssetUrl(asset.url), "Link"),
    copyEmbed: (asset) => void copyWithToast(asset.markdown, "Embed"),
    renameAsset: (asset) => setNameDialog({ mode: "rename-asset", asset }),
    renameFolder: (folder) => setNameDialog({ mode: "rename", folder }),
    move: (items) => setMoveSelection(itemsFor(items)),
    bin: (items) => void requestBin(items),
    openFolder,
    showInFolder: spansFolders ? showInFolder : undefined,
    showDetails: () => changeDetails(true),
    newFolder: () => setNameDialog({ mode: "create" }),
    uploadFiles: () => fileInputRef.current?.click(),
    uploadFolder: () => folderInputRef.current?.click(),
    selectAll: () => {
      setSelection(selectAll(visibleAssetIds, visibleFolderIds));
      setTicking(true);
    },
    clearSelection,
    select: (item) => {
      setSelectMode(true);
      const already = item.kind === "asset" ? selectedAssetIds.has(item.id) : selectedFolderIds.has(item.id);
      // Entering selection mode keeps what is selected only if it was a
      // deliberate selection already; a lone highlight is replaced.
      if (!already) {
        if (!selecting) {
          setSelection(
            item.kind === "asset"
              ? { assetIds: [item.id], folderIds: [], anchor: item.id }
              : { assetIds: [], folderIds: [item.id], anchor: item.id },
          );
          setTicking(true);
          updateLibraryUrl({ asset: item.kind === "asset" ? item.id : null });
        } else {
          toggleItem(item.kind, item.id);
        }
      }
    },
    startSelecting: () => {
      setSelectMode(true);
      setTicking(true);
    },
  };

  // On a phone, Back leaves selection mode rather than the page.
  useCloseOnBack(clearSelection, selecting && coarsePointer);

  /** A finger resting on an item selects it, like a phone gallery. */
  function handleItemLongPress(clicked: { kind: "asset" | "folder"; id: string }) {
    navigator.vibrate?.(12);
    actions.select(clicked);
  }

  function renameSelected() {
    if (selected && selectedCount === 1) actions.renameAsset(selected);
    else if (selectedFolder) actions.renameFolder(selectedFolder);
  }

  // Library shortcuts, ignored while typing or with a dialog or menu open.
  // See LibraryShortcutsDialog for the list.
  useEffect(() => {
    if (openId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [role='dialog'], [role='menu']"))
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const item = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-asset-id], [data-folder-id]") : null;
      const onItem = item !== null;
      const focusedAsset = item?.dataset.assetId ? assets.find((asset) => asset.id === item.dataset.assetId) : null;
      const previewable = focusedAsset ?? (selectedCount === 1 ? selected : null);

      if (mod && event.key.toLowerCase() === "a" && !missingFolder) {
        event.preventDefault();
        actions.selectAll();
      } else if (mod) {
        return;
      } else if (event.key === "Escape" && (selectedCount > 0 || selectMode)) {
        event.preventDefault();
        clearSelection();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedCount > 0) {
        event.preventDefault();
        void requestBin(liveSelection);
      } else if (event.key === "Enter" && !onItem && selectedCount === 1) {
        event.preventDefault();
        if (selected) openViewer(selected);
        else if (selectedFolder) openFolder(selectedFolder.id);
      } else if (event.key === " " && previewable) {
        // Space previews, as in a file manager (and doesn't re-click a focused card).
        event.preventDefault();
        openViewer(previewable);
      } else if (event.key.toLowerCase() === "i" && !event.shiftKey) {
        event.preventDefault();
        changeDetails(!detailsOpen);
      } else if (event.key === "F2" && selectedCount === 1) {
        event.preventDefault();
        renameSelected();
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /** Touch has no hover or double-click: a tap opens, unless selecting. */
  function tapOpens() {
    return !selecting && window.matchMedia("(hover: none)").matches;
  }

  function handleItemClick(asset: AssetLibraryItem, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (tapOpens()) {
      openViewer(asset);
      return;
    }
    const mode = selecting && (selectMode || window.matchMedia("(hover: none)").matches) ? "toggle" : selectionMode(event);
    const next = applySelectionClick(liveSelection, { kind: "asset", id: asset.id, mode, order: visibleAssetIds });
    setSelection(next);
    setTicking(mode !== "replace");
    const single = selectionSize(next) === 1 && next.assetIds.length === 1 ? next.assetIds[0] : null;
    updateLibraryUrl({ asset: single });
  }

  function toggleItem(kind: "asset" | "folder", id: string) {
    const next = applySelectionClick(liveSelection, {
      kind,
      id,
      mode: "toggle",
      order: kind === "asset" ? visibleAssetIds : visibleFolderIds,
    });
    setSelection(next);
    setTicking(true);
    const single = selectionSize(next) === 1 && next.assetIds.length === 1 ? next.assetIds[0] : null;
    updateLibraryUrl({ asset: single });
  }

  function handleFolderClick(folderId: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (tapOpens()) {
      openFolder(folderId);
      return;
    }
    const mode = selecting && (selectMode || window.matchMedia("(hover: none)").matches) ? "toggle" : selectionMode(event);
    setSelection(applySelectionClick(liveSelection, { kind: "folder", id: folderId, mode, order: visibleFolderIds }));
    setTicking(mode !== "replace");
    updateLibraryUrl({ asset: null });
  }

  /** What a right-click landed on; selects it first when it wasn't part of the selection. */
  function handleMenuTarget(clicked: { kind: "asset" | "folder"; id: string } | null) {
    const resolved = resolveContextTarget(liveSelection, clicked);
    setMenuTarget(resolved.target);
    if (resolved.selection !== liveSelection) {
      setSelection(resolved.selection);
      setTicking(false);
      const single = resolved.target.kind === "asset" ? resolved.target.id : null;
      updateLibraryUrl({ asset: single });
    }
  }

  /** Dragging a selected item drags the whole selection. */
  function dragPayloadFor(kind: "asset" | "folder", id: string): MediaDragPayload {
    const inSelection = kind === "asset" ? selectedAssetIds.has(id) : selectedFolderIds.has(id);
    if (inSelection && selectedCount > 1) {
      return { assetIds: liveSelection.assetIds, folderIds: liveSelection.folderIds };
    }
    return kind === "asset" ? { assetIds: [id], folderIds: [] } : { assetIds: [], folderIds: [id] };
  }

  function changeView(next: MediaView) {
    setView(next);
    void setMediaLibraryViewAction({ view: next }).catch(() => undefined);
  }

  function changeShowNames(next: boolean) {
    setShowNames(next);
    void setMediaLibraryViewAction({ showNames: next }).catch(() => undefined);
  }

  function enqueueInto(files: File[], folderId: string | null) {
    if (files.length > 0) uploads.enqueue(files, undefined, { folderId });
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    enqueueInto(files, currentFolderId);
  }

  function handleFolderSelected(event: ChangeEvent<HTMLInputElement>) {
    const dropped = filesFromDirectoryInput(event.target.files);
    event.target.value = "";
    void uploadDroppedTree({ dropped, parentFolderId: currentFolderId, enqueue: enqueueInto });
  }

  /** OS files dropped onto the page or a folder: plain files, or whole folders. */
  function uploadDrop(dataTransfer: DataTransfer, folderId: string | null) {
    // Read synchronously, inside the drop event; the tree is walked afterwards.
    const pending = collectDroppedFiles(dataTransfer);
    void pending.then((dropped) => {
      if (dropped.some((item) => item.relativePath.includes("/"))) {
        void uploadDroppedTree({ dropped, parentFolderId: folderId, enqueue: enqueueInto });
      } else {
        enqueueInto(
          dropped.map((item) => item.file),
          folderId,
        );
      }
    });
  }

  function moveDropped(payload: MediaDragPayload, targetId: string | null, targetName: string) {
    void moveMediaItems({
      assetIds: payload.assetIds,
      folderIds: payload.folderIds,
      targetFolderId: targetId,
      targetName,
    });
  }

  // The whole page accepts files from the OS (into the folder on screen);
  // Vault items dragged around it are handled by folders and breadcrumbs.
  const pageDrop = {
    onDragEnter: (event: DragEvent) => {
      if (!isFileDrag(event) || isMediaDrag(event) || !canAdd) return;
      event.preventDefault();
      fileDropDepth.current += 1;
      setFileDropActive(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event) || isMediaDrag(event) || !canAdd) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!isFileDrag(event) || isMediaDrag(event) || !canAdd) return;
      fileDropDepth.current = Math.max(0, fileDropDepth.current - 1);
      if (fileDropDepth.current === 0) setFileDropActive(false);
    },
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event) || isMediaDrag(event) || !canAdd) return;
      event.preventDefault();
      fileDropDepth.current = 0;
      setFileDropActive(false);
      uploadDrop(event.dataTransfer, currentFolderId);
    },
  };

  const folderHandlers: FolderItemHandlers = {
    selectedFolderIds,
    sharedFolderIds,
    previews,
    selecting,
    dragDisabled: coarsePointer,
    onFolderClick: (folder, event) => handleFolderClick(folder.id, event),
    onFolderToggle: (folder) => toggleItem("folder", folder.id),
    onFolderOpen: (folder) => openFolder(folder.id),
    onFolderDragStart: (folder, event) => startMediaDrag(event, dragPayloadFor("folder", folder.id)),
    onFolderDropItems: (folder, payload) => moveDropped(payload, folder.id, folder.name),
    onFolderDropFiles: (folder, dataTransfer) => uploadDrop(dataTransfer, folder.id),
  };

  const placeTitle = place === "shared" ? "Shared" : searching ? "Search results" : (currentFolder?.name ?? ROOT_LABEL);
  const shownBytes = visibleAssets.reduce((total, asset) => total + asset.sizeBytes, 0);
  const shownSummary = [
    folderTiles.length > 0 ? plural(folderTiles.length, "folder") : null,
    plural(visibleAssets.length, "file"),
    visibleAssets.length > 0 ? formatBytes(shownBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const chips = [
    ...(kindFilter !== "all"
      ? [{ key: "kind", label: KIND_LABELS[kindFilter], onRemove: () => updateLibraryUrl({ kind: null }) }]
      : []),
    ...(visibilityFilter !== "all"
      ? [
          {
            key: "visibility",
            label: visibilityFilter === "public" ? "Public in gallery" : "Not in gallery",
            onRemove: () => updateLibraryUrl({ visibility: null }),
          },
        ]
      : []),
    ...querySummary.map((summary) => ({ key: `q:${summary}`, label: summary })),
    ...(searching && place === "files" ? [{ key: "scope", label: "Every folder" }] : []),
  ];

  const menu = (() => {
    const target = menuTarget;
    if (target.kind === "asset") {
      const asset = assets.find((candidate) => candidate.id === target.id);
      if (asset) return <AssetMenuItems asset={asset} actions={actions} />;
    } else if (target.kind === "folder") {
      const folder = folderById.get(target.id);
      if (folder) return <FolderMenuItems folder={folder} actions={actions} />;
    } else if (target.kind === "selection") {
      return <SelectionMenuItems assetIds={target.assetIds} folderIds={target.folderIds} actions={actions} />;
    }
    return (
      <PlaceMenuItems
        actions={actions}
        canAdd={canAdd}
        view={view}
        onViewChange={changeView}
        sort={sortMode}
        onSortChange={setSortMode}
      />
    );
  })();

  const gallery = missingFolder ? (
    <EmptyState
      icon={FolderX}
      title="This folder isn't here"
      body="It may have been moved to the Bin, deleted, or it belongs to someone else."
    >
      <Button type="button" variant="outline" onClick={() => openFolder(null)}>
        Back to {ROOT_LABEL}
      </Button>
    </EmptyState>
  ) : libraryEmpty && place === "files" ? (
    <EmptyState
      icon={ImageIcon}
      title="No files yet"
      body={`Upload ${unrestrictedUploads ? "any file" : "photos, videos or PDFs"}, drop a whole folder from a camera card onto this page, or add one from a document's toolbar.`}
    >
      <Button type="button" onClick={actions.uploadFiles}>
        Upload files
      </Button>
    </EmptyState>
  ) : visibleAssets.length + folderTiles.length > 0 ? (
    <MediaItemView
      key={`${place}|${currentFolderId ?? "root"}|${query}|${kindFilter}|${visibilityFilter}|${sortMode}|${view}`}
      view={view}
      assets={visibleAssets}
      folders={folderTiles}
      folderHandlers={folderHandlers}
      sort={sortMode}
      onSortChange={setSortMode}
      selectedIds={selectedAssetIds}
      selecting={selecting}
      dragDisabled={coarsePointer}
      showNames={showNames}
      onItemClick={handleItemClick}
      onItemToggle={(asset) => toggleItem("asset", asset.id)}
      onItemOpen={openViewer}
      onItemDragStart={(asset, event) => startMediaDrag(event, dragPayloadFor("asset", asset.id))}
      locationOf={spansFolders ? locationOf : undefined}
      sharedIds={sharedAssetIds}
    />
  ) : place === "shared" ? (
    <EmptyState
      icon={Link2}
      title={searching ? "Nothing shared matches" : "Nothing is shared"}
      body="Folders and files you share by link, or list in your public gallery, appear here. Right-click anything and choose Share…"
    />
  ) : searching ? (
    <EmptyState icon={Search} title="No matches" body="Clear the search or filters to see the rest of your library." />
  ) : (
    <EmptyState
      icon={FolderOpen}
      title={currentFolder ? "This folder is empty" : "Nothing here yet"}
      body="Drop photos or a whole folder onto this page, or use New."
    />
  );

  return (
    <>
      <WorkspacePageRegistration
        page={ASSETS_PAGE}
        rightPanel={detailsOpen ? panelSlot : undefined}
        rightPanelTitle="Details"
        onRightPanelClose={closeDetails}
      />

      {/* Container queries: the space this page gets depends on which side
          panels are open, so breakpoints follow the page, not the window.
          The explicit `minmax(0,1fr)` column matters: an implicit `auto` track
          never shrinks below its content's min-content width, and the
          multi-column card grid reports that as roughly (columns × the
          longest unbroken filename), which pushed the page past its column. */}
      <div className="@container relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" {...pageDrop}>
        {fileDropActive ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-primary/8 backdrop-blur-[1px]">
            <p className="rounded-md bg-background/90 px-4 py-2 text-sm font-medium shadow">
              Drop to upload to {currentFolder?.name ?? ROOT_LABEL}
            </p>
          </div>
        ) : null}

        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-center gap-1">
            {place === "files" && !searching && !missingFolder ? (
              <FolderBreadcrumbs
                rootLabel={ROOT_LABEL}
                trail={breadcrumbs}
                onNavigate={openFolder}
                onDropItems={moveDropped}
              />
            ) : (
              <h1 className="truncate px-1 text-xl font-semibold tracking-tight">{placeTitle}</h1>
            )}
            {currentFolder && !searching ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for folder ${currentFolder.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:bg-muted"
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                  <FolderMenuItems folder={currentFolder} actions={{ ...actions, bin: binCurrentFolder }} current />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {!missingFolder ? <p className="text-sm text-muted-foreground">{shownSummary}</p> : null}
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept={unrestrictedUploads ? undefined : UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          onChange={handleFilesSelected}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={handleFolderSelected}
          {...{ webkitdirectory: "", directory: "" }}
        />

        {!libraryEmpty || place === "shared" ? (
          <LibraryToolbar
            query={query}
            onQueryChange={setQuery}
            kind={kindFilter}
            onKindChange={(kind) => updateLibraryUrl({ kind: kind === "all" ? null : kind })}
            chips={chips}
            sort={sortMode}
            onSortChange={setSortMode}
            view={view}
            onViewChange={changeView}
            showNames={showNames}
            onShowNamesChange={changeShowNames}
            detailsOpen={detailsOpen}
            onToggleDetails={() => changeDetails(!detailsOpen)}
            canAdd={canAdd}
            uploading={uploads.hasActive}
            onNewFolder={actions.newFolder}
            onUploadFiles={actions.uploadFiles}
            onUploadFolder={actions.uploadFolder}
          />
        ) : null}

        <LibraryContextMenu
          onTarget={handleMenuTarget}
          onItemLongPress={handleItemLongPress}
          menu={menu}
          className="min-h-[60vh] pb-20"
        >
          {gallery}
        </LibraryContextMenu>

        {selecting ? (
          <SelectionBar
            count={selectedCount}
            onMove={() => actions.move(liveSelection)}
            onBin={() => void requestBin(liveSelection)}
            onSelectAll={actions.selectAll}
            onClear={clearSelection}
            menu={
              // One item: its whole menu (on touch, long-press then More is
              // how you reach it). Several: what applies to all of them.
              selectedCount === 1 && selected ? (
                <AssetMenuItems asset={selected} actions={actions} inSelection />
              ) : selectedCount === 1 && selectedFolder ? (
                <FolderMenuItems folder={selectedFolder} actions={actions} inSelection />
              ) : (
                <SelectionMenuItems
                  assetIds={liveSelection.assetIds}
                  folderIds={liveSelection.folderIds}
                  actions={actions}
                />
              )
            }
          />
        ) : null}
      </div>

      {canAdd && !selecting ? (
        <NewFloatingButton
          uploading={uploads.hasActive}
          onUploadFiles={actions.uploadFiles}
          onUploadFolder={actions.uploadFolder}
          onNewFolder={actions.newFolder}
        />
      ) : null}
      <UploadTray items={uploads.items} onCancel={uploads.cancel} onDismiss={uploads.dismiss} />

      <FolderNameDialog
        open={nameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setNameDialog(null);
        }}
        title={
          nameDialog?.mode === "rename" ? "Rename folder" : nameDialog?.mode === "rename-asset" ? "Rename file" : "New folder"
        }
        description={nameDialog?.mode === "create" ? `Inside ${currentFolder?.name ?? ROOT_LABEL}.` : undefined}
        confirmLabel={nameDialog?.mode === "create" ? "Create" : "Rename"}
        initialName={
          nameDialog?.mode === "rename"
            ? nameDialog.folder.name
            : nameDialog?.mode === "rename-asset"
              ? nameDialog.asset.displayName
              : "Untitled folder"
        }
        onSubmit={async (name) => {
          if (nameDialog?.mode === "rename") {
            await renameMediaFolder(nameDialog.folder.id, name);
          } else if (nameDialog?.mode === "rename-asset") {
            const current = assets.find((asset) => asset.id === nameDialog.asset.id) ?? nameDialog.asset;
            await patchAsset(current, { displayName: name });
          } else {
            await createMediaFolder({ name, parentId: currentFolderId });
          }
          setNameDialog(null);
        }}
      />
      <MoveToFolderDialog
        open={moveSelection !== null}
        onOpenChange={(open) => {
          if (!open) setMoveSelection(null);
        }}
        folders={folders}
        selection={moveSelection ?? { assets: [], folderIds: [] }}
        onMove={async (targetFolderId, targetName) => {
          if (!moveSelection) return;
          const moved = await moveMediaItems({
            assetIds: moveSelection.assets.map((asset) => asset.id),
            folderIds: moveSelection.folderIds,
            targetFolderId,
            targetName,
          });
          if (moved) {
            setMoveSelection(null);
            clearSelection();
          }
        }}
      />

      <ShareLinkDialog
        target={shareTarget}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null);
        }}
      />
      <LibraryShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ConfirmDialog
        open={binWarning !== null}
        onOpenChange={(open) => {
          if (!open) setBinWarning(null);
        }}
        tone="destructive"
        icon={Trash2}
        title={(() => {
          const count = binWarning ? usageDocumentCount(binWarning.usage) : 0;
          return `Used in ${count} ${count === 1 ? "document" : "documents"}`;
        })()}
        description={
          binWarning
            ? binWarning.items.assetIds.length + binWarning.items.folderIds.length === 1
              ? "In the Bin it stops showing for everyone else straight away, and documents that embed it show a placeholder until you restore it. Open one to see where:"
              : "In the Bin they stop showing for everyone else straight away, and documents that embed them show a placeholder until you restore them. Open one to see where:"
            : null
        }
        body={binWarning ? <AssetUsageList usage={binWarning.usage} onNavigate={() => setBinWarning(null)} /> : null}
        confirmLabel="Move to Bin anyway"
        onConfirm={() => {
          const run = binWarning?.run;
          setBinWarning(null);
          if (run) void run();
        }}
      />

      {viewerIndex !== -1 ? (
        <MediaViewer
          items={viewerItems}
          index={viewerIndex}
          onIndexChange={(index) => {
            const next = viewerItems[index];
            if (next) updateLibraryUrl({ open: next.id });
          }}
          onClose={closeViewer}
          locationOf={locationOf}
          onVideoReady={(asset, video) => {
            // A video whose poster wasn't captured at upload (a busy machine, a
            // closed tab) gets one now, from the frame on screen.
            if (asset.thumbUrl || healedPosters.current.has(asset.id)) return;
            healedPosters.current.add(asset.id);
            void attachVideoPoster(asset.id, video).then((stored) => {
              if (stored) dispatchAssetsChanged();
            });
          }}
          onVideoUnplayable={(asset) => {
            // This browser can't decode it (Motion-JPEG MOVs, some HEVC): the
            // server can still make a poster for the grid.
            if (asset.thumbUrl || healedPosters.current.has(asset.id)) return;
            healedPosters.current.add(asset.id);
            void requestServerPoster(asset.id).then((stored) => {
              if (stored) dispatchAssetsChanged();
            });
          }}
        />
      ) : null}

      {detailsOpen && panelHost ? createPortal(renderDetails(), panelHost) : null}
    </>
  );

  /** Binning the folder on screen goes up to its parent. */
  function binCurrentFolder() {
    if (!currentFolder) return;
    const folder = currentFolder;
    const parent = folder.parentId;
    void requestBin({ assetIds: [], folderIds: [folder.id] }, () =>
      moveFolderToBin(folder).then((moved) => {
        if (moved) openFolder(parent);
      }),
    );
  }

  function folderStats(folderId: string | null) {
    const inside =
      folderId === null ? null : new Set([folderId, ...descendantFolderIds(folders, folderId)]);
    const bytes = assets.reduce(
      (total, asset) => (inside === null || (asset.folderId && inside.has(asset.folderId)) ? total + asset.sizeBytes : total),
      0,
    );
    return folderId === null
      ? { files: assets.length, folders: folders.length, bytes }
      : {
          files: directCounts.files.get(folderId) ?? 0,
          folders: directCounts.subfolders.get(folderId) ?? 0,
          bytes,
        };
  }

  function renderDetails(): ReactNode {
    if (selectedCount > 1) {
      return (
        <SelectionDetails
          assets={assets.filter((asset) => selectedAssetIds.has(asset.id))}
          folderCount={liveSelection.folderIds.length}
          menu={
            <SelectionMenuItems
              assetIds={liveSelection.assetIds}
              folderIds={liveSelection.folderIds}
              actions={{ ...actions, showDetails: () => undefined }}
            />
          }
        />
      );
    }
    if (selected) {
      return (
        <AssetDetails
          key={selected.id}
          asset={selected}
          folderName={selected.folderId ? (folderById.get(selected.folderId)?.name ?? null) : null}
          linked={sharedAssetIds.has(selected.id)}
          menu={<AssetMenuItems asset={selected} actions={actions} inPanel />}
          onView={() => openViewer(selected)}
          onOpenFolder={() => showInFolder(selected)}
          onShare={() => share({ kind: "asset", id: selected.id, name: selected.displayName })}
          onSaved={mergeSaved}
        />
      );
    }
    if (selectedFolder) {
      return (
        <FolderDetails
          key={selectedFolder.id}
          name={selectedFolder.name}
          stats={folderStats(selectedFolder.id)}
          previews={previews.get(selectedFolder.id) ?? []}
          location={selectedFolder.parentId ? (folderById.get(selectedFolder.parentId)?.name ?? null) : null}
          linked={sharedFolderIds.has(selectedFolder.id)}
          createdAt={selectedFolder.createdAt}
          menu={<FolderMenuItems folder={selectedFolder} actions={actions} inPanel />}
        />
      );
    }
    if (place === "shared") {
      return (
        <FolderDetails
          name="Shared"
          stats={{ files: visibleAssets.length, folders: folderTiles.length, bytes: shownBytes }}
          previews={visibleAssets.flatMap((asset) => (asset.thumbUrl ? [asset.thumbUrl] : [])).slice(0, 4)}
          hint="Everything here can be seen outside Vault. Select an item to see how."
        />
      );
    }
    if (currentFolder) {
      return (
        <FolderDetails
          key={currentFolder.id}
          name={currentFolder.name}
          stats={folderStats(currentFolder.id)}
          previews={previews.get(currentFolder.id) ?? []}
          location={currentFolder.parentId ? (folderById.get(currentFolder.parentId)?.name ?? null) : null}
          linked={sharedFolderIds.has(currentFolder.id)}
          createdAt={currentFolder.createdAt}
          menu={<FolderMenuItems folder={currentFolder} actions={{ ...actions, bin: binCurrentFolder }} current inPanel />}
          hint="Select a file or folder to see its details."
        />
      );
    }
    return (
      <FolderDetails
        name={ROOT_LABEL}
        stats={folderStats(null)}
        previews={assets.flatMap((asset) => (asset.thumbUrl ? [asset.thumbUrl] : [])).slice(0, 4)}
        extraRows={[
          [
            "Storage",
            `${formatBytes(usedBytes)} of ${storageQuotaBytes > 0 ? formatBytes(storageQuotaBytes) : "unlimited"}`,
          ],
        ]}
        hint="Select a file or folder to see its details. The Bin still counts toward storage."
      />
    );
  }
}

/**
 * The bar while selecting: the count, the common actions, everything else in
 * More (an item's whole menu when one is selected), and close. On a phone it
 * spans the width with thumb-sized buttons labelled under their icons; on
 * wider screens it is a compact pill. With nothing ticked yet (selection mode
 * entered from a menu) it says what to do and offers Select all.
 */
function SelectionBar({
  count,
  onMove,
  onBin,
  onSelectAll,
  onClear,
  menu,
}: {
  count: number;
  onMove: () => void;
  onBin: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  menu: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className="sticky bottom-3 z-30 mx-auto flex w-full items-center gap-1 rounded-2xl border border-border/80 bg-popover/95 p-1.5 text-sm shadow-lg backdrop-blur sm:bottom-4 sm:w-fit sm:max-w-full sm:rounded-full sm:py-1 sm:pl-4 sm:pr-1"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection (Esc)"
        title="Clear selection (Esc)"
        className="order-first grid size-12 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:order-last sm:size-8 sm:rounded-full"
      >
        <X className="size-5 sm:size-4" />
      </button>
      <span
        className="min-w-0 flex-1 truncate whitespace-nowrap px-1 text-base font-semibold tabular-nums sm:mr-2 sm:flex-none sm:px-0 sm:text-sm sm:font-medium"
        aria-live="polite"
      >
        {count > 0 ? `${count} selected` : "Tap items to select"}
      </span>
      {count === 0 ? (
        <BarButton icon={CheckSquare} label="Select all" onClick={onSelectAll} />
      ) : (
        <>
          <BarButton icon={FolderInput} label="Move" title="Move to…" onClick={onMove} />
          <BarButton icon={Trash2} label="Bin" title="Move to Bin" onClick={onBin} destructive />
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More actions" title="More actions" className={barButtonClass}>
              <MoreHorizontal className="size-5 sm:size-4" />
              <span>More</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-56">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}

const barButtonClass =
  "flex h-12 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.7rem] font-medium text-foreground transition hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:bg-muted sm:h-8 sm:min-w-0 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-sm";

function BarButton({
  icon: Icon,
  label,
  title,
  onClick,
  destructive = false,
}: {
  icon: typeof X;
  label: string;
  title?: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={title ?? label}
      className={cn(barButtonClass, destructive && "text-destructive")}
    >
      <Icon className="size-5 sm:size-4" />
      <span>{label}</span>
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof ImageIcon;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
}

function parseKindFilter(value: string | null): KindFilter {
  return value === "image" || value === "pdf" || value === "video" || value === "file" ? value : "all";
}

function parseVisibilityFilter(value: string | null): VisibilityFilter {
  return value === "private" || value === "public" ? value : "all";
}

/** Targets a background click must not treat as "empty space". */
const backgroundClickIgnore =
  "[data-asset-card], [data-folder-tile], a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='option'], [role='combobox'], [role='listbox'], [role='toolbar']";

/**
 * Shallow URL update: Next keeps `useSearchParams` in sync with
 * `history.replaceState`, so filters and selection change without a server
 * round trip, yet stay linkable and survive a reload.
 */
function updateLibraryUrl(changes: Record<string, string | null>, options: { push?: boolean } = {}) {
  const params = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  // `null` state, not `history.state`: Next marks its own entries there, and a
  // call carrying those markers is treated as internal and never synced.
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (options.push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function filterAndSortAssets(
  assets: AssetLibraryItem[],
  filters: {
    query: ReturnType<typeof parseContentSearchQuery>;
    kind: KindFilter;
    visibility: VisibilityFilter;
    sort: MediaSort;
  },
) {
  return sortMediaAssets(
    assets.filter((asset) => {
      if (filters.kind !== "all" && asset.kind !== filters.kind) return false;
      if (filters.visibility !== "all" && asset.visibility !== filters.visibility) return false;

      return matchesContentSearchQuery(
        {
          title: asset.displayName,
          altText: asset.altText,
          description: asset.description,
          mimeType: asset.mimeType,
          kind: asset.kind,
          visibility: asset.visibility,
          tags: asset.tags,
        },
        filters.query,
      );
    }),
    filters.sort,
  );
}
