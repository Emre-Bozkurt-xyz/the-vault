"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Download, File as FileIcon, FileText, Film, Folder, ImageIcon, Play } from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { formatDuration } from "@/components/assets/MediaItemViews";
import { JustifiedGrid } from "@/components/assets/JustifiedGrid";
import { MediaViewer } from "@/components/assets/MediaViewer";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetTypeLabel } from "@/components/assets/asset-ui";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { tileAspect } from "@/lib/media-library";
import { cn } from "@/lib/utils";

export type SharedGalleryFolder = { id: string; name: string; files: number; folders: number; href: string };

/**
 * The public side of a media share link (`/s/<token>`): no workspace, no
 * account, just the shared folder (or file): subfolders, a phone-gallery
 * mosaic of thumbnails (the library's `JustifiedGrid`), the same full-screen
 * viewer as the library, and, when the owner allows it, downloads.
 */
export function SharedMediaGallery({
  title,
  sharedBy,
  path,
  folders,
  assets,
  allowDownload,
  zipHref,
  singleItem = false,
}: {
  title: string;
  sharedBy: string;
  /** Root-first crumbs inside the shared tree; the last is the current folder. */
  path: { name: string; href: string }[];
  folders: SharedGalleryFolder[];
  assets: AssetLibraryItem[];
  allowDownload: boolean;
  zipHref: string | null;
  singleItem?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const totalBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0);
  const counts = [
    folders.length > 0 ? `${folders.length} ${folders.length === 1 ? "folder" : "folders"}` : null,
    `${assets.length} ${assets.length === 1 ? "file" : "files"}`,
    assets.length > 0 ? formatBytes(totalBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="@container grid gap-6">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-6 @3xl:flex-row @3xl:items-end @3xl:justify-between">
        <div className="min-w-0">
          {path.length > 1 ? (
            <nav aria-label="Folder path" className="flex flex-wrap items-center gap-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.26em]">
              {path.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-0.5">
                  {index > 0 ? <ChevronRight aria-hidden className="size-3 text-muted-foreground/70" /> : null}
                  {index === path.length - 1 ? (
                    <span className="text-foreground/80">{crumb.name}</span>
                  ) : (
                    <Link href={crumb.href} className="rounded px-1 text-muted-foreground transition hover:text-foreground">
                      {crumb.name}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          ) : (
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
              Shared {singleItem ? "file" : "folder"}
            </p>
          )}
          <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight vault-display sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Shared by {sharedBy}
            {singleItem ? "" : ` · ${counts}`}
          </p>
        </div>
        {zipHref && allowDownload && assets.length + folders.length > 0 ? (
          <a href={zipHref} className={cn(buttonVariants(), "shrink-0")} download>
            <Download data-icon="inline-start" />
            Download all
          </a>
        ) : null}
      </header>

      {folders.length > 0 ? (
        <section aria-label="Folders" className="grid gap-2 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
          {folders.map((folder) => (
            <Link
              key={folder.id}
              href={folder.href}
              className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Folder className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{folder.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    folder.folders > 0 ? `${folder.folders} ${folder.folders === 1 ? "folder" : "folders"}` : null,
                    `${folder.files} ${folder.files === 1 ? "file" : "files"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      {assets.length > 0 ? (
        singleItem ? (
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            <SharedCard asset={assets[0]} onOpen={() => setOpen(0)} />
          </div>
        ) : (
          <JustifiedGrid
            entries={assets.map((asset, index) => ({
              key: asset.id,
              aspect: tileAspect({
                width: asset.width,
                height: asset.height,
                pictured: asset.thumbUrl !== null,
              }),
              node: <SharedTile asset={asset} onOpen={() => setOpen(index)} />,
            }))}
          />
        )
      ) : folders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/80 px-5 py-12 text-center text-sm text-muted-foreground">
          This folder is empty.
        </p>
      ) : null}

      {open !== null ? (
        <MediaViewer
          items={assets}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          allowOriginals={allowDownload}
        />
      ) : null}
    </div>
  );
}

/** A mosaic tile: the picture edge to edge, its name on hover. */
function SharedTile({ asset, onOpen }: { asset: AssetLibraryItem; onOpen: () => void }) {
  const pictured = asset.thumbUrl !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={asset.displayName}
      className="group relative block size-full overflow-hidden rounded-[3px] bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <RenditionImage
        src={asset.thumbUrl}
        alt={asset.altText ?? asset.displayName}
        className="size-full object-cover"
        fallback={
          <span className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <KindIcon kind={asset.kind} />
            <span className="text-xs">{assetTypeLabel(asset)}</span>
          </span>
        }
      />
      {asset.kind === "video" ? (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[0.7rem] font-medium text-white tabular-nums transition-opacity group-hover:opacity-0">
          <Play className="size-3 fill-current" aria-hidden />
          {asset.durationMs ? formatDuration(asset.durationMs) : "Video"}
        </span>
      ) : null}
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-1.5 pt-8 text-white transition-opacity",
          pictured ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "opacity-100",
        )}
      >
        <span className="block truncate text-xs font-medium sm:text-sm">{asset.displayName}</span>
      </span>
    </button>
  );
}

/** The single shared file, at display size with its name under it. */
function SharedCard({ asset, onOpen }: { asset: AssetLibraryItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group mb-4 block w-full overflow-hidden rounded-md border border-border/70 bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="relative block bg-muted">
        <RenditionImage
          src={asset.displayUrl}
          alt={asset.altText ?? asset.displayName}
          width={asset.width}
          height={asset.height}
          className="h-auto w-full object-cover"
          fallback={
            <span className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <KindIcon kind={asset.kind} />
              <span className="text-xs">{assetTypeLabel(asset)}</span>
            </span>
          }
        />
        {asset.kind === "video" ? (
          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[0.7rem] font-medium text-white tabular-nums">
            <Play className="size-3 fill-current" aria-hidden />
            {asset.durationMs ? formatDuration(asset.durationMs) : "Video"}
          </span>
        ) : null}
      </span>
      <span className="block px-3 py-2.5">
        <span className="block truncate text-sm font-medium">{asset.displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
        </span>
      </span>
    </button>
  );
}

function KindIcon({ kind }: { kind: AssetLibraryItem["kind"] }) {
  const Icon = kind === "video" ? Film : kind === "pdf" ? FileText : kind === "image" ? ImageIcon : FileIcon;
  return <Icon className="size-8" />;
}
