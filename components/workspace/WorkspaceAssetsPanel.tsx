"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, Folder, FolderOpen, ImageIcon, Images, Link2, Trash2, Upload } from "lucide-react";

import { UploadProgressList } from "@/components/assets/UploadProgressList";
import { useAssetUploads } from "@/components/assets/useAssetUploads";
import {
  SidePanel,
  SidePanelAction,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  SidePanelNavItem,
  SidePanelSection,
  useActiveHref,
} from "@/components/workspace/SidePanel";
import { dispatchAssetsChanged, subscribeToAssetsChanged } from "@/lib/asset-events";
import { formatBytes } from "@/lib/format";
import { useVisibleRefresh } from "@/components/workspace/panel-visibility";
import { fetchAssetLibrary } from "@/lib/shared-request";
import { childFolders, folderPath, type FolderNode } from "@/lib/asset-folders";
import { cn } from "@/lib/utils";

const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm";
// `view` and `folder` are places; type filters are not, so "All files" stays
// highlighted while one is applied.
const PLACE_KEYS = ["view", "folder"];

/** `GET /api/assets?view=summary`. */
type AssetsSummaryResponse = {
  counts: { all: number };
  binCount?: number;
  sharedCount?: number;
  folders?: FolderNode[];
  storage?: { usedBytes: number; quotaBytes: number; unrestrictedUploadsAllowed: boolean };
};

/**
 * Assets mode of the left panel: where you are in the library, and nothing
 * else. Places (All files, Shared, Bin), the folder tree, and storage; type
 * filters live in the library's toolbar. Uploading works from any page.
 * Data comes from `GET /api/assets?view=summary` and refreshes whenever any
 * asset view reports a change.
 */
export function WorkspaceAssetsPanel() {
  const [data, setData] = useState<AssetsSummaryResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isActive = useActiveHref();

  const cancelledRef = useRef(false);
  // While the panel is collapsed, changes only mark the list stale; it reloads
  // once, when the panel is shown again.
  const requestLoad = useVisibleRefresh(
    useCallback(() => {
      fetchAssetLibrary("summary")
        .then((next) => next as AssetsSummaryResponse | null)
        .then((next) => {
          if (next && !cancelledRef.current) setData(next);
        })
        // Keep whatever we had; the panel is a convenience view.
        .catch(() => undefined);
    }, []),
  );

  useEffect(() => {
    cancelledRef.current = false;
    requestLoad();
    const unsubscribe = subscribeToAssetsChanged(() => requestLoad());

    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, [requestLoad]);

  const uploads = useAssetUploads({
    onSettled: () => dispatchAssetsChanged(),
    autoDismissMs: 3000,
  });

  const storage = data?.storage;
  const folders = useMemo(() => data?.folders ?? [], [data?.folders]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Uploading from the panel while a folder is open puts files in that folder.
  const openFolderId =
    pathname === "/assets"
      ? (folders.find((folder) => folder.id === searchParams.get("folder"))?.id ?? null)
      : null;

  return (
    <SidePanel>
      <SidePanelHeader
        icon={ImageIcon}
        title="Assets"
        subtitle="Photos, videos and files"
        actions={
          <SidePanelAction
            icon={Upload}
            label={openFolderId ? "Upload to this folder" : "Upload"}
            onClick={() => fileInputRef.current?.click()}
          />
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={storage?.unrestrictedUploadsAllowed ? undefined : UPLOAD_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          if (files.length > 0) uploads.enqueue(files, undefined, { folderId: openFolderId });
        }}
      />

      <SidePanelBody>
        {uploads.items.length > 0 ? (
          <UploadProgressList
            items={uploads.items}
            onCancel={uploads.cancel}
            onDismiss={uploads.dismiss}
            className="mb-3"
          />
        ) : null}

        <SidePanelSection title="Library">
          <SidePanelNavItem
            href="/assets"
            icon={Images}
            label="All files"
            trailing={data ? data.counts.all : null}
            active={isActive("/assets", { filterKeys: PLACE_KEYS })}
          />
          <SidePanelNavItem
            href="/assets?view=shared"
            icon={Link2}
            label="Shared"
            trailing={data && data.sharedCount ? data.sharedCount : null}
            active={isActive("/assets?view=shared")}
          />
          <SidePanelNavItem
            href="/assets?view=bin"
            icon={Trash2}
            label="Bin"
            trailing={data && data.binCount ? data.binCount : null}
            active={isActive("/assets?view=bin")}
          />
        </SidePanelSection>

        <SidePanelSection title="Folders" count={data ? folders.length : undefined}>
          {data === null ? null : folders.length === 0 ? (
            <SidePanelEmpty>
              No folders yet. Use New in the library, or drop a folder onto it.
            </SidePanelEmpty>
          ) : (
            <FolderTreeNav folders={folders} activeId={openFolderId} />
          )}
        </SidePanelSection>
      </SidePanelBody>

      {storage ? <StorageMeter used={storage.usedBytes} quota={storage.quotaBytes} /> : null}
    </SidePanel>
  );
}

/** One slim meter, shown once. The Bin still counts until it empties. */
function StorageMeter({ used, quota }: { used: number; quota: number }) {
  const ratio = quota > 0 ? Math.min(used / quota, 1) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div className="shrink-0 border-t border-border/70 px-4 py-3">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
      >
        <div
          className={cn("h-full rounded-full transition-all", ratio >= 0.9 ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
        {formatBytes(used)} of {quota > 0 ? formatBytes(quota) : "unlimited"} used
      </p>
    </div>
  );
}

/**
 * The media folder tree as navigation. A branch is open when it leads to the
 * open folder, unless the user toggled it; their choice wins.
 */
function FolderTreeNav({ folders, activeId }: { folders: FolderNode[]; activeId: string | null }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const onActivePath = useMemo(
    () => new Set(folderPath(folders, activeId).map((folder) => folder.id)),
    [activeId, folders],
  );

  function renderLevel(parentId: string | null) {
    return childFolders(folders, parentId).map((folder) => {
      const hasChildren = folders.some((child) => child.parentId === folder.id);
      const open = overrides[folder.id] ?? onActivePath.has(folder.id);
      const active = folder.id === activeId;

      return (
        <li key={folder.id}>
          <div
            className={cn(
              "group flex h-8 min-w-0 items-center rounded-md text-sm transition",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            )}
          >
            <button
              type="button"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              aria-expanded={hasChildren ? open : undefined}
              disabled={!hasChildren}
              onClick={() => setOverrides((current) => ({ ...current, [folder.id]: !open }))}
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground disabled:invisible"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
            <Link
              href={`/assets?folder=${folder.id}`}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 pr-2"
            >
              {active ? (
                <FolderOpen className="size-4 shrink-0 text-foreground" aria-hidden />
              ) : (
                <Folder className="size-4 shrink-0" aria-hidden />
              )}
              <span className={cn("truncate", active ? "text-foreground" : "text-foreground/90")}>
                {folder.name}
              </span>
            </Link>
          </div>
          {open && hasChildren ? (
            <ul className="ml-3 border-l border-border/50 pl-1">{renderLevel(folder.id)}</ul>
          ) : null}
        </li>
      );
    });
  }

  return <ul>{renderLevel(null)}</ul>;
}
