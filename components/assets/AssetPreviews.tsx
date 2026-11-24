"use client";

import { File as FileIcon, FileText, Film, ImageIcon } from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetExtensionBadge } from "@/components/assets/asset-ui";
import { cn } from "@/lib/utils";

type MediaFields = "kind" | "altText" | "displayName" | "mimeType" | "width" | "height";

/** A card-width thumbnail (the Bin's cards). */
export function AssetThumbnail({
  asset,
}: {
  asset: Pick<AssetLibraryItem, MediaFields | "thumbUrl">;
}) {
  const tile = <FileTile asset={asset} className="aspect-[4/3]" />;

  if (asset.kind !== "image" && asset.kind !== "video") return tile;

  return (
    <span className="block bg-muted">
      <RenditionImage
        src={asset.thumbUrl}
        alt={asset.altText ?? asset.displayName}
        width={asset.width}
        height={asset.height}
        className="h-auto w-full object-cover"
        fallback={tile}
      />
    </span>
  );
}

/** The panel-sized preview: the display copy, contained, or a file tile. */
export function AssetPreview({
  asset,
  className,
}: {
  asset: Pick<AssetLibraryItem, MediaFields | "displayUrl">;
  className?: string;
}) {
  const tile = <FileTile asset={asset} className={cn("h-36 rounded-md border border-border/60", className)} />;

  if (asset.kind !== "image" && asset.kind !== "video") return tile;

  return (
    <div
      className={cn(
        "grid max-h-64 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/40",
        className,
      )}
    >
      <RenditionImage
        src={asset.displayUrl}
        alt={asset.altText ?? asset.displayName}
        width={asset.width}
        height={asset.height}
        className="max-h-64 w-full object-contain"
        loading="eager"
        fallback={tile}
      />
    </div>
  );
}

export function FileTile({
  asset,
  className,
}: {
  asset: Pick<AssetLibraryItem, "kind" | "displayName" | "mimeType">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <AssetKindIcon kind={asset.kind} className="size-9" />
      <span className="rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wider">
        {assetExtensionBadge(asset)}
      </span>
    </span>
  );
}

export function AssetKindIcon({
  kind,
  className,
}: {
  kind: AssetLibraryItem["kind"];
  className?: string;
}) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf") return <FileText className={className} />;
  if (kind === "video") return <Film className={className} />;
  return <FileIcon className={className} />;
}
