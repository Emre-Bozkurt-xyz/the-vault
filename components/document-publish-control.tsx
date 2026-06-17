"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, FileText, LockKeyhole, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type PrivateEmbeddedAsset = {
  id: string;
  kind: "image" | "pdf";
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

type DocumentPublishControlProps = {
  documentId: string;
  privateAssets: PrivateEmbeddedAsset[];
  action: (formData: FormData) => void | Promise<void>;
};

export function DocumentPublishControl({
  documentId,
  privateAssets,
  action,
}: DocumentPublishControlProps) {
  const [open, setOpen] = useState(false);

  if (privateAssets.length === 0) {
    return (
      <form action={action}>
        <input type="hidden" name="documentId" value={documentId} />
        <Button type="submit" variant="outline" size="sm" className="w-full">
          Publish
        </Button>
      </form>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-2 border-amber-500/45 text-amber-200 hover:bg-amber-500/10"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle className="size-3.5" />
        Review publish
      </Button>
      <p className="text-xs leading-5 text-amber-200/80">
        {privateAssets.length} private embed
        {privateAssets.length === 1 ? "" : "s"} will be hidden on the public page.
      </p>

      {open ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-background/72 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-private-assets-title"
        >
          <div className="w-full max-w-lg border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border/70 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-amber-200">
                  <LockKeyhole className="size-4" />
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em]">
                    Private embeds
                  </p>
                </div>
                <h2
                  id="publish-private-assets-title"
                  className="mt-2 text-lg font-semibold"
                >
                  Publish this document?
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The document will become public, but these assets stay private.
                  Anonymous readers will see unavailable asset labels until you
                  publish the assets separately.
                </p>
              </div>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center border border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                aria-label="Close publish warning"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto p-4">
              <div className="grid gap-2">
                {privateAssets.map((asset) => (
                  <PrivateAssetRow key={asset.id} asset={asset} />
                ))}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border/70 p-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <form action={action}>
                <input type="hidden" name="documentId" value={documentId} />
                <Button type="submit" variant="outline" size="sm" className="w-full">
                  Publish anyway
                </Button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PrivateAssetRow({ asset }: { asset: PrivateEmbeddedAsset }) {
  const icon: ReactNode =
    asset.kind === "pdf" ? (
      <FileText className="size-4" />
    ) : (
      <span className="text-[0.65rem] font-bold">IMG</span>
    );

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border border-border/70 bg-background/40 p-3">
      <span className="grid size-8 place-items-center border border-border/70 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {asset.displayName}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {asset.mimeType} - {formatBytes(asset.sizeBytes)}
        </span>
      </span>
    </div>
  );
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KiB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}
