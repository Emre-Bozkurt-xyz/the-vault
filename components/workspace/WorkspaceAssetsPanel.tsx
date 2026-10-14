"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  File as FileIcon,
  FileText,
  Globe2,
  ImageIcon,
  Images,
  Library,
  Upload,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { assetTypeLabel } from "@/components/assets/asset-ui";
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
import { cn } from "@/lib/utils";

const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const RECENT_COUNT = 8;
const FILTER_KEYS = ["kind", "visibility"];

type AssetsResponse = {
  assets?: AssetLibraryItem[];
  storage?: { usedBytes: number; quotaBytes: number; unrestrictedUploadsAllowed: boolean };
};

/**
 * Assets mode of the left panel: the library's filters as navigation (each a
 * deep link into `/assets`), recent uploads, and uploading without leaving the
 * current page. Data comes from `GET /api/assets` and refreshes whenever any
 * asset view reports a change.
 */
export function WorkspaceAssetsPanel() {
  const [data, setData] = useState<AssetsResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isActive = useActiveHref();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/assets")
        .then((response) => (response.ok ? (response.json() as Promise<AssetsResponse>) : null))
        .then((next) => {
          if (next && !cancelled) setData(next);
        })
        // Keep whatever we had; the panel is a convenience view.
        .catch(() => undefined);

    void load();
    const unsubscribe = subscribeToAssetsChanged(() => void load());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const uploads = useAssetUploads({
    onSettled: () => dispatchAssetsChanged(),
    autoDismissMs: 3000,
  });

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: assets.length,
      image: assets.filter((asset) => asset.kind === "image").length,
      pdf: assets.filter((asset) => asset.kind === "pdf").length,
      file: assets.filter((asset) => asset.kind === "file").length,
      public: assets.filter((asset) => asset.visibility === "public").length,
    }),
    [assets],
  );
  const recent = useMemo(
    () =>
      [...assets]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, RECENT_COUNT),
    [assets],
  );
  const storage = data?.storage;

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
          if (files.length > 0) uploads.enqueue(files);
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

function AssetThumb({ asset }: { asset: AssetLibraryItem }) {
  const frame = "grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-border/60 bg-muted/60";

  if (asset.kind === "image") {
    return (
      <span className={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.url} alt="" className="size-full object-cover" loading="lazy" />
      </span>
    );
  }

  const Icon = asset.kind === "pdf" ? FileText : FileIcon;
  return (
    <span className={cn(frame, "text-muted-foreground")}>
      <Icon className="size-4" />
    </span>
  );
}
