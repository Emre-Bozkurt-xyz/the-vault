"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  Folder,
  MoreHorizontal,
  MousePointerClick,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { AssetPreview, AssetThumbnail } from "@/components/assets/AssetPreviews";
import {
  deleteAssetsForever,
  emptyAssetBin,
  restoreAssets,
} from "@/components/assets/asset-bin-actions";
import { assetTypeLabel } from "@/components/assets/asset-ui";
import { AssetUsageList, fetchAssetUsage, usageDocumentCount, type AssetUsage } from "@/components/assets/AssetUsage";
import { deleteFolderForever, restoreFolder } from "@/components/assets/folder-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WithContextMenu } from "@/components/ui/use-context-menu";
import {
  ContextPanelBody,
  ContextPanelFacts,
  ContextPanelSection,
} from "@/components/workspace/ContextPanel";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { requestOpenRightPanel } from "@/lib/document-command-events";
import { subscribeToAssetsChanged } from "@/lib/asset-events";
import { binDaysRemaining, formatBinCountdown } from "@/lib/asset-lifecycle";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { formatBytes } from "@/lib/format";
import { fetchAssetLibrary } from "@/lib/shared-request";
import { cn } from "@/lib/utils";

export type BinAssetItem = AssetLibraryItem & {
  trashedAt: Date | string;
  purgeAt: Date | string;
};

/** A folder in the Bin, with what was binned along with it. */
export type BinFolderItem = {
  id: string;
  name: string;
  trashedAt: Date | string;
  purgeAt: Date | string;
  assetCount: number;
  folderCount: number;
  sizeBytes: number;
};

type PendingDelete =
  | { kind: "asset"; item: BinAssetItem }
  | { kind: "folder"; item: BinFolderItem };

const BIN_PAGE = { type: "assets", title: "Bin", href: "/assets?view=bin" } as const;

/**
 * `/assets?view=bin`: binned assets, each restorable until it is deleted for
 * good `binRetentionDays` after it was binned. Binned bytes still count toward
 * the storage quota, which the header says plainly, and Empty Bin states how
 * much it frees before it runs.
 */
export function AssetBinClient({
  initialAssets,
  initialFolders,
}: {
  initialAssets: BinAssetItem[];
  initialFolders: BinFolderItem[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [folders, setFolders] = useState(initialFolders);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDeleteState] = useState<PendingDelete | null>(null);
  // What still embeds the item about to be deleted (null while checking).
  const [deleteUsage, setDeleteUsage] = useState<{ key: string; usage: AssetUsage[] } | null>(null);
  const setPendingDelete = useCallback((next: PendingDelete | null) => {
    setPendingDeleteState(next);
    if (!next) return;
    const key = `${next.kind}:${next.item.id}`;
    void fetchAssetUsage(next.kind === "asset" ? { assetIds: [next.item.id] } : { folderIds: [next.item.id] }).then(
      (usage) => setDeleteUsage({ key, usage }),
    );
  }, []);
  const pendingUsage =
    pendingDelete && deleteUsage?.key === `${pendingDelete.kind}:${pendingDelete.item.id}` ? deleteUsage.usage : [];
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const binBytes = useMemo(
    () =>
      assets.reduce((total, asset) => total + asset.sizeBytes, 0) +
      folders.reduce((total, folder) => total + folder.sizeBytes, 0),
    [assets, folders],
  );
  const itemCount = assets.length + folders.length;

  const refresh = useCallback(async () => {
    try {
      const payload = (await fetchAssetLibrary("bin")) as {
        assets?: BinAssetItem[];
        folders?: BinFolderItem[];
      } | null;
      if (payload?.assets) setAssets(payload.assets);
      if (payload?.folders) setFolders(payload.folders);
    } catch {
      // Keep what we have.
    }
  }, []);

  // Moves to the Bin from other tabs/panels, and Undo, land here too.
  useEffect(() => subscribeToAssetsChanged(() => void refresh()), [refresh]);

  const drop = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setAssets((current) => current.filter((asset) => !ids.includes(asset.id)));
    setSelectedId((current) => (current && ids.includes(current) ? null : current));
  }, []);

  const restore = useCallback(
    async (asset: BinAssetItem) => drop(await restoreAssets([asset])),
    [drop],
  );

  async function restoreBinFolder(folder: BinFolderItem) {
    if (await restoreFolder(folder)) {
      setFolders((current) => current.filter((candidate) => candidate.id !== folder.id));
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    if (target.kind === "asset") {
      drop(await deleteAssetsForever([target.item]));
    } else if (await deleteFolderForever(target.item)) {
      setFolders((current) => current.filter((folder) => folder.id !== target.item.id));
    }
  }

  async function confirmEmpty() {
    setConfirmingEmpty(false);
    setBusy(true);
    if (await emptyAssetBin()) {
      setAssets([]);
      setFolders([]);
      setSelectedId(null);
    }
    setBusy(false);
  }

  function select(asset: BinAssetItem) {
    setSelectedId(asset.id);
    requestOpenRightPanel();
  }

  const panel = useMemo(
    () =>
      selected ? (
        <BinDetailsPanel
          key={selected.id}
          asset={selected}
          onRestore={() => void restore(selected)}
          onDelete={() => setPendingDelete({ kind: "asset", item: selected })}
        />
      ) : (
        <div className="grid flex-1 place-content-center gap-2 px-6 py-16 text-center">
          <MousePointerClick className="mx-auto size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nothing selected</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Choose an item to preview it, restore it, or delete it for good.
          </p>
        </div>
      ),
    [restore, selected, setPendingDelete],
  );

  return (
    <>
      <WorkspacePageRegistration page={BIN_PAGE} rightPanel={panel} rightPanelTitle="Bin item" />

      <div className="@container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <nav aria-label="Folder path" className="flex min-w-0 items-center gap-0.5">
            <Link
              href="/assets"
              className="rounded px-1 py-0.5 text-xl font-semibold tracking-tight text-muted-foreground transition hover:text-foreground"
            >
              All files
            </Link>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
            <h1 className="px-1 text-xl font-semibold tracking-tight">Bin</h1>
          </nav>
          <p className="text-sm text-muted-foreground">
            {itemCount} {itemCount === 1 ? "item" : "items"} · {formatBytes(binBytes)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={itemCount === 0 || busy}
            onClick={() => setConfirmingEmpty(true)}
          >
            <Trash2 data-icon="inline-start" />
            {busy ? "Emptying…" : "Empty Bin"}
          </Button>
          <p className="basis-full px-1 text-xs text-muted-foreground">
            Deleted for good {ASSET_LIMITS.binRetentionDays} days after being moved here. Until then,
            items still count toward your storage.
          </p>
        </header>

        {folders.length > 0 ? (
          <section aria-label="Folders in the Bin" className="grid gap-2 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
            {folders.map((folder) => (
              <WithContextMenu key={folder.id}>
                {(menu) => (
                  <div
                    data-folder-tile
                    onContextMenu={menu.onContextMenu}
                    className="group relative flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5 pr-11 shadow-sm"
                  >
                    <Folder className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{folder.name}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Countdown trashedAt={folder.trashedAt} />
                        <span aria-hidden>·</span>
                        <span className="truncate">{describeBinFolder(folder)}</span>
                      </span>
                    </span>
                    <DropdownMenu {...menu.rootProps}>
                      <DropdownMenuTrigger
                        ref={menu.triggerRef}
                        aria-label={`Actions for folder ${folder.name}`}
                        className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44" {...menu.contentProps}>
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => void restoreBinFolder(folder)}>
                            <RotateCcw /> Restore
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete({ kind: "folder", item: folder })}
                          >
                            <Trash2 /> Delete forever
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </WithContextMenu>
            ))}
          </section>
        ) : null}

        {assets.length > 0 ? (
          <div className="min-w-0 columns-1 gap-4 @sm:columns-2 @2xl:columns-3 @5xl:columns-4 @7xl:columns-5">
            {assets.map((asset) => (
              <WithContextMenu key={asset.id}>
                {(menu) => (
                  <div
                    data-asset-card
                    onContextMenu={menu.onContextMenu}
                    className="group relative mb-4 break-inside-avoid"
                  >
                    <button
                      type="button"
                      onClick={() => select(asset)}
                      aria-pressed={selected?.id === asset.id}
                      className={cn(
                        "block w-full overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        selected?.id === asset.id
                          ? "border-primary/70 ring-1 ring-primary/35"
                          : "border-border/70",
                      )}
                    >
                      <span className="block opacity-80 grayscale-[35%] transition group-hover:opacity-100 group-hover:grayscale-0">
                        <AssetThumbnail asset={asset} />
                      </span>
                      <span className="block px-3 py-2.5">
                        <span className="block truncate text-sm font-medium">
                          {asset.displayName}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Countdown trashedAt={asset.trashedAt} />
                          <span aria-hidden>·</span>
                          <span className="truncate">{formatBytes(asset.sizeBytes)}</span>
                        </span>
                      </span>
                    </button>
                    <DropdownMenu {...menu.rootProps}>
                      <DropdownMenuTrigger
                        ref={menu.triggerRef}
                        aria-label={`Actions for ${asset.displayName}`}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute right-2 top-2 grid size-8 place-items-center rounded-md border border-border/70 bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44" {...menu.contentProps}>
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => void restore(asset)}>
                            <RotateCcw /> Restore
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete({ kind: "asset", item: asset })}
                          >
                            <Trash2 /> Delete forever
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </WithContextMenu>
            ))}
          </div>
        ) : folders.length > 0 ? null : (
          <div className="rounded-md border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
            <Trash2 className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">The Bin is empty</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Assets you move to the Bin wait here for {ASSET_LIMITS.binRetentionDays} days
              so you can change your mind.
            </p>
            <Link href="/assets" className={cn(buttonVariants({ variant: "outline" }), "mx-auto mt-5")}>
              <ArrowLeft data-icon="inline-start" />
              Back to the library
            </Link>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        tone="destructive"
        icon={Trash2}
        title="Delete forever?"
        description={
          pendingDelete?.kind === "asset" ? (
            <>
              <span className="font-medium break-words text-foreground">
                {pendingDelete.item.displayName}
              </span>{" "}
              will be removed from storage and {formatBytes(pendingDelete.item.sizeBytes)} freed.
              Documents that embed it keep a placeholder. This cannot be undone.
              {usageDocumentCount(pendingUsage) > 0 ? " It's still embedded in:" : null}
            </>
          ) : pendingDelete?.kind === "folder" ? (
            <>
              <span className="font-medium break-words text-foreground">
                {pendingDelete.item.name}
              </span>{" "}
              and {describeBinFolder(pendingDelete.item)} inside it will be removed from
              storage and {formatBytes(pendingDelete.item.sizeBytes)} freed. This cannot be
              undone.
              {usageDocumentCount(pendingUsage) > 0 ? " Files in it are still embedded in:" : null}
            </>
          ) : null
        }
        body={
          usageDocumentCount(pendingUsage) > 0 ? (
            <AssetUsageList usage={pendingUsage} onNavigate={() => setPendingDelete(null)} />
          ) : null
        }
        confirmLabel="Delete forever"
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={confirmingEmpty}
        onOpenChange={setConfirmingEmpty}
        tone="destructive"
        icon={Trash2}
        title="Empty the Bin?"
        description={`Everything in the Bin (${itemCount} ${itemCount === 1 ? "item" : "items"}, including what's inside binned folders) will be removed from storage and ${formatBytes(binBytes)} freed. This cannot be undone.`}
        confirmLabel="Empty Bin"
        onConfirm={() => void confirmEmpty()}
      />
    </>
  );
}

function BinDetailsPanel({
  asset,
  onRestore,
  onDelete,
}: {
  asset: BinAssetItem;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextPanelBody>
      <div className="grid gap-3 border-b border-border/60 p-4">
        <AssetPreview asset={asset} />
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold leading-snug">{asset.displayName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" onClick={onRestore}>
            <RotateCcw data-icon="inline-start" />
            Restore
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDelete}>
            <Trash2 data-icon="inline-start" />
            Delete forever
          </Button>
        </div>
      </div>
      <ContextPanelSection icon={Clock3} title="In the Bin">
        <ContextPanelFacts
          items={[
            { label: "Moved here", value: formatDate(asset.trashedAt) },
            { label: "Deleted for good", value: formatDate(asset.purgeAt) },
            { label: "Uploaded", value: formatDate(asset.createdAt) },
          ]}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Restoring puts it back exactly as it was: same link, visibility, tags, and
          document embeds.
        </p>
      </ContextPanelSection>
    </ContextPanelBody>
  );
}

function describeBinFolder(folder: BinFolderItem) {
  const parts = [
    folder.folderCount > 0
      ? `${folder.folderCount} ${folder.folderCount === 1 ? "folder" : "folders"}`
      : null,
    `${folder.assetCount} ${folder.assetCount === 1 ? "file" : "files"}`,
  ];
  return parts.filter(Boolean).join(", ");
}

function Countdown({ trashedAt }: { trashedAt: Date | string }) {
  const days = binDaysRemaining(trashedAt);
  return (
    // Depends on the clock, so the server's render can differ by a day at midnight.
    <span
      suppressHydrationWarning
      className={cn("shrink-0", days <= 3 ? "text-destructive" : undefined)}
    >
      {formatBinCountdown(trashedAt)}
    </span>
  );
}

function formatDate(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
