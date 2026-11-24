"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  FileText,
  Globe2,
  ImageIcon,
  Images,
  Library,
  Trash2,
  Upload,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { assetTypeLabel } from "@/components/assets/asset-ui";
import { RenditionImage } from "@/components/assets/RenditionImage";
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
import { requestOpenRightPanel } from "@/lib/document-command-events";
import { formatBytes } from "@/lib/format";
import { useVisibleRefresh } from "@/components/workspace/panel-visibility";
import { fetchAssetLibrary } from "@/lib/shared-request";
import { childFolders, folderPath, type FolderNode } from "@/lib/asset-folders";
import { cn } from "@/lib/utils";

const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
// `view` and `folder` too: the Bin and folders are places, not "All assets".
const FILTER_KEYS = ["kind", "visibility", "view", "folder"];

type RecentAsset = Pick<
  AssetLibraryItem,
  "id" | "kind" | "displayName" | "sizeBytes" | "mimeType" | "createdAt" | "url" | "thumbUrl"
>;

/** `GET /api/assets?view=summary`. */
type AssetsSummaryResponse = {
  counts: { all: number; image: number; pdf: number; file: number; public: number };
  recent: RecentAsset[];
  binCount?: number;
  folders?: FolderNode[];
  storage?: { usedBytes: number; quotaBytes: number; unrestrictedUploadsAllowed: boolean };
};

const emptyCounts: AssetsSummaryResponse["counts"] = {
  all: 0,
  image: 0,
  pdf: 0,
  file: 0,
  public: 0,
};

/**
 * Assets mode of the left panel: the library's filters as navigation (each a
 * deep link into `/assets`), recent uploads, and uploading without leaving the
 * current page. Data comes from `GET /api/assets` and refreshes whenever any
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

  const counts = data?.counts ?? emptyCounts;
  const recent = data?.recent ?? [];
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
        subtitle={
          storage
            ? `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.quotaBytes)} used`
            : "Your uploads"
        }
        actions={
          <>
            <SidePanelAction
              icon={Upload}
              label="Upload"
              onClick={() => fileInputRef.current?.click()}
            />
            <SidePanelAction icon={Library} label="Open library" href="/assets" />
          </>
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
            label="All assets"
            trailing={data ? counts.all : null}
            active={isActive("/assets", { filterKeys: FILTER_KEYS })}
          />
          <SidePanelNavItem
            href="/assets?kind=image"
            icon={ImageIcon}
            label="Images"
            trailing={data ? counts.image : null}
            active={isActive("/assets?kind=image")}
          />
          <SidePanelNavItem
            href="/assets?kind=pdf"
            icon={FileText}
            label="PDFs"
            trailing={data ? counts.pdf : null}
            active={isActive("/assets?kind=pdf")}
          />
          {counts.file > 0 || storage?.unrestrictedUploadsAllowed ? (
            <SidePanelNavItem
              href="/assets?kind=file"
              icon={FileIcon}
              label="Other files"
              trailing={data ? counts.file : null}
              active={isActive("/assets?kind=file")}
            />
          ) : null}
          <SidePanelNavItem
            href="/assets?visibility=public"
            icon={Globe2}
            label="Public"
            trailing={data ? counts.public : null}
            active={isActive("/assets?visibility=public")}
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
              No folders yet. Create one from the library, or drop a folder onto it.
            </SidePanelEmpty>
          ) : (
            <FolderTreeNav folders={folders} activeId={openFolderId} />
          )}
        </SidePanelSection>

        <SidePanelSection title="Recent uploads" count={data ? recent.length : undefined}>
          {data === null ? (
            <SidePanelEmpty>Loading…</SidePanelEmpty>
          ) : recent.length === 0 ? (
            <SidePanelEmpty>
              Nothing uploaded yet. Use Upload above, or drop an image into a document.
            </SidePanelEmpty>
          ) : (
            recent.map((asset) => (
              <SidePanelNavItem
                key={asset.id}
                href={`/assets?asset=${asset.id}`}
                leading={<AssetThumb asset={asset} />}
                label={asset.displayName}
                detail={`${assetTypeLabel(asset)} · ${formatBytes(asset.sizeBytes)}`}
                active={isActive(`/assets?asset=${asset.id}`)}
                // The details live in the right panel; make sure it is showing.
                onClick={() => requestOpenRightPanel()}
              />
            ))
          )}
        </SidePanelSection>
      </SidePanelBody>
    </SidePanel>
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

function AssetThumb({ asset }: { asset: RecentAsset }) {
  const frame = "grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-border/60 bg-muted/60";

  const Icon = asset.kind === "pdf" ? FileText : asset.kind === "image" ? ImageIcon : FileIcon;
  const icon = <Icon className="size-4 text-muted-foreground" />;

  return (
    <span className={frame}>
      {asset.kind === "image" ? (
        <RenditionImage
          src={asset.thumbUrl}
          alt=""
          className="size-full object-cover"
          fallback={icon}
        />
      ) : (
        icon
      )}
    </span>
  );
}
