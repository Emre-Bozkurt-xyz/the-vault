"use client";

import type { ReactNode } from "react";
import {
  Code2,
  Download,
  ExternalLink,
  Fingerprint,
  Link2,
  MoreHorizontal,
} from "lucide-react";

import {
  absoluteAssetUrl,
  copyWithToast,
  downloadAsset,
} from "@/components/assets/asset-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ContextMenuController } from "@/components/ui/use-context-menu";
import { cn } from "@/lib/utils";

export type ActionableAsset = {
  id: string;
  kind: "image" | "pdf" | "file";
  displayName: string;
  url: string;
  markdown: string;
};

/**
 * The "…" quick-actions menu on an asset card: open, download, and the copy
 * actions people otherwise had to open the details panel for. `children` adds
 * page-specific items (e.g. delete in the library) after a separator. Pass
 * `contextMenu` (from `useContextMenu`) to also open it by right-clicking the
 * card.
 */
export function AssetActionsMenu({
  asset,
  showCopyId = false,
  className,
  contextMenu,
  children,
}: {
  asset: ActionableAsset;
  showCopyId?: boolean;
  className?: string;
  contextMenu?: ContextMenuController;
  children?: ReactNode;
}) {
  return (
    <DropdownMenu {...contextMenu?.rootProps}>
      <DropdownMenuTrigger
        aria-label={`Actions for ${asset.displayName}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "grid size-8 place-items-center rounded-md border border-border/70 bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          className,
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        {...contextMenu?.contentProps}
      >
        <DropdownMenuGroup>
          {asset.kind !== "file" ? (
            <DropdownMenuItem
              onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink /> Open in new tab
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => downloadAsset(asset)}>
            <Download /> Download
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void copyWithToast(asset.markdown, "Embed")}>
            <Code2 /> Copy embed
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copyWithToast(absoluteAssetUrl(asset.url), "Link")}
          >
            <Link2 /> Copy link
          </DropdownMenuItem>
          {showCopyId ? (
            <DropdownMenuItem onClick={() => void copyWithToast(asset.id, "ID")}>
              <Fingerprint /> Copy ID
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {children ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>{children}</DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
