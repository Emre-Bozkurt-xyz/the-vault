"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  Code2,
  Copy,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Globe2,
  ImageIcon,
  Loader2,
  Lock,
  MousePointerClick,
  PenLine,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  Upload,
} from "lucide-react";

import { AssetActionsMenu } from "@/components/assets/AssetActionsMenu";
import {
  assetExtensionBadge,
  assetTypeLabel,
  copyWithToast,
  downloadAsset,
} from "@/components/assets/asset-ui";
import { UploadProgressList } from "@/components/assets/UploadProgressList";
import { useAssetUploads } from "@/components/assets/useAssetUploads";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TagAutocompleteInput } from "@/components/tag-autocomplete-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ContextPanelBody,
  ContextPanelSection,
} from "@/components/workspace/ContextPanel";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { requestOpenRightPanel } from "@/lib/document-command-events";
import { formatBytes } from "@/lib/format";
import {
  getContentSearchSummary,
  matchesContentSearchQuery,
  parseContentSearchQuery,
} from "@/lib/content-search-query";
import { cn } from "@/lib/utils";

export type AssetLibraryItem = {
  id: string;
  kind: "image" | "pdf" | "file";
  displayName: string;
  description: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
  createdAt: Date | string;
  tags: string[];
  url: string;
  markdown: string;
};

type AssetDraft = {
  displayName: string;
  altText: string;
  description: string;
  visibility: "private" | "public";
  tags: string;
};
type KindFilter = "all" | "image" | "pdf" | "file";
type VisibilityFilter = "all" | "private" | "public";
type SortMode = "newest" | "oldest" | "name" | "size";

const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const ASSETS_PAGE = { type: "assets", title: "Assets", href: "/assets" } as const;

export function AssetLibraryClient({
  initialAssets,
  storageQuotaBytes,
  unrestrictedUploads = false,
}: {
  initialAssets: AssetLibraryItem[];
  storageQuotaBytes: number;
  /** Admin grant: the picker offers every file type, not just media. */
  unrestrictedUploads?: boolean;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAssets[0]?.id ?? null,
  );
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const [draft, setDraft] = useState<AssetDraft>(() => toDraft(selected));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const storage = useMemo(() => summarizeStorage(assets), [assets]);
  const dirty = selected !== null && !sameDraft(draft, toDraft(selected));

  // The configure panel lives in the workspace's right panel (resizable and
  // collapsible like a document's). The page registers an empty host there and
  // portals the panel into it, so its form state stays here. The shell can
  // mount two hosts (desktop aside, mobile sheet); the newest one wins.
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
  const querySummary = useMemo(
    () => getContentSearchSummary(parsedQuery),
    [parsedQuery],
  );
  const uploads = useAssetUploads({
    onSettled: () => void refreshAssets().catch(() => undefined),
    autoDismissMs: 4000,
  });
  const visibleAssets = useMemo(
    () =>
      filterAndSortAssets(assets, {
        query: parsedQuery,
        kind: kindFilter,
        visibility: visibilityFilter,
        sort: sortMode,
      }),
    [assets, kindFilter, parsedQuery, sortMode, visibilityFilter],
  );

  function selectAsset(asset: AssetLibraryItem) {
    setSelectedId(asset.id);
    setDraft(toDraft(asset));
    setMessage(null);

    // Collapsed panel (or the mobile sheet): bring the details into view.
    if (!panelHost || panelHost.offsetParent === null) {
      requestOpenRightPanel();
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";

    if (files.length > 0) {
      setMessage(null);
      uploads.enqueue(files);
    }
  }

  async function refreshAssets() {
    const listResponse = await fetch("/api/assets");
    const listPayload = (await listResponse.json()) as {
      assets?: AssetLibraryItem[];
      error?: string;
    };

    if (!listResponse.ok || !listPayload.assets) {
      return;
    }

    const refreshed = listPayload.assets;
    setAssets(refreshed);

    if (!refreshed.some((asset) => asset.id === selectedId) && refreshed[0]) {
      setSelectedId(refreshed[0].id);
      setDraft(toDraft(refreshed[0]));
    }
  }

  async function saveAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          tags: draft.tags
            .split(/\s+/)
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        asset?: AssetLibraryItem;
        error?: string;
      };

      if (!response.ok || !payload.asset) {
        throw new Error(payload.error ?? "Could not save asset.");
      }

      setAssets((current) =>
        current.map((asset) =>
          asset.id === payload.asset?.id ? payload.asset : asset,
        ),
      );
      setDraft(toDraft(payload.asset));
      setMessage("Asset saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save asset.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedAsset() {
    if (!selected) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${selected.displayName}"? This removes it from documents, the library, gallery, and R2 storage.`,
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/assets/${selected.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        asset?: { id: string };
        error?: string;
      };

      if (!response.ok || !payload.asset) {
        throw new Error(payload.error ?? "Could not delete asset.");
      }

      setAssets((current) =>
        current.filter((asset) => asset.id !== payload.asset?.id),
      );
      const nextAsset = assets.find((asset) => asset.id !== payload.asset?.id) ?? null;
      setSelectedId(nextAsset?.id ?? null);
      setDraft(toDraft(nextAsset));
      setMessage("Asset deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete asset.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <WorkspacePageRegistration
        page={ASSETS_PAGE}
        rightPanel={panelSlot}
        rightPanelTitle="Asset"
      />

      <div className="grid min-w-0 gap-6">
        <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
              Asset library
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Content
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Private uploads used by your documents. Publish an asset only when
              it should be visible outside private docs.
            </p>
          </div>
          <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-[6.5rem_16rem]">
            <Metric label="Assets" value={String(assets.length)} />
            <StorageBar used={storage.bytes} quota={storageQuotaBytes} />
          </div>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept={unrestrictedUploads ? undefined : UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          onChange={handleFilesSelected}
        />

        {assets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[10rem] flex-1 basis-40">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">Search assets</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, tags, kind:image…"
                className="pl-9"
              />
            </label>
            <FilterSelect
              label="Filter by asset type"
              value={kindFilter}
              onChange={(value) => setKindFilter(value as KindFilter)}
              options={[
                ["all", "All types"],
                ["image", "Images"],
                ["pdf", "PDFs"],
                ["file", "Other files"],
              ]}
            />
            <FilterSelect
              label="Filter by visibility"
              value={visibilityFilter}
              onChange={(value) => setVisibilityFilter(value as VisibilityFilter)}
              options={[
                ["all", "Any visibility"],
                ["private", "Private"],
                ["public", "Public"],
              ]}
            />
            <FilterSelect
              label="Sort assets"
              value={sortMode}
              onChange={(value) => setSortMode(value as SortMode)}
              options={[
                ["newest", "Newest"],
                ["oldest", "Oldest"],
                ["name", "Name"],
                ["size", "Largest"],
              ]}
            />
            <Button type="button" onClick={openFilePicker}>
              {uploads.hasActive ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Upload
            </Button>
          </div>
        ) : null}

        <UploadProgressList
          items={uploads.items}
          onCancel={uploads.cancel}
          onDismiss={uploads.dismiss}
          className="sm:grid-cols-2 xl:grid-cols-3"
        />

        {querySummary.length > 0 ? (
          <div className="-mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {querySummary.map((summary) => (
              <span
                key={summary}
                className="rounded-full border border-border/70 bg-card px-2 py-1"
              >
                {summary}
              </span>
            ))}
          </div>
        ) : null}

        {assets.length > 0 && visibleAssets.length > 0 ? (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
            {visibleAssets.map((asset) => (
              <div key={asset.id} className="group relative mb-4 break-inside-avoid">
                <button
                  type="button"
                  onClick={() => selectAsset(asset)}
                  aria-pressed={selected?.id === asset.id}
                  className={cn(
                    "block w-full overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    selected?.id === asset.id
                      ? "border-primary/70 ring-1 ring-primary/35"
                      : "border-border/70",
                  )}
                >
                  <AssetThumbnail asset={asset} />
                  <span className="flex items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {asset.displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
                      </span>
                    </span>
                    <VisibilityIcon visibility={asset.visibility} />
                  </span>
                </button>
                <AssetActionsMenu
                  asset={asset}
                  className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <DropdownMenuItem onClick={() => selectAsset(asset)}>
                    <SlidersHorizontal /> Edit details
                  </DropdownMenuItem>
                </AssetActionsMenu>
              </div>
            ))}
          </div>
        ) : assets.length > 0 ? (
          <div className="rounded-md border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
            <Search className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No matching assets</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Clear the search or filters to see the rest of your library.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
            <ImageIcon className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No assets yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Upload {unrestrictedUploads ? "any file" : "an image or PDF"} to get
              started, or add one from the image upload button in a
              document&apos;s Markdown toolbar.
            </p>
            <Button type="button" onClick={openFilePicker} className="mx-auto mt-5">
              {uploads.hasActive ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Upload asset
            </Button>
          </div>
        )}
      </div>

      {panelHost
        ? createPortal(
            selected ? (
              <AssetConfigurePanel
                key={selected.id}
                asset={selected}
                draft={draft}
                setDraft={setDraft}
                dirty={dirty}
                saving={saving}
                deleting={deleting}
                message={message}
                onSubmit={saveAsset}
                onReset={() => {
                  setDraft(toDraft(selected));
                  setMessage(null);
                }}
                onDelete={() => void deleteSelectedAsset()}
              />
            ) : (
              <div className="grid flex-1 place-content-center gap-2 px-6 py-16 text-center">
                <MousePointerClick className="mx-auto size-6 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing selected</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Choose an asset to preview it and edit its details.
                </p>
              </div>
            ),
            panelHost,
          )
        : null}
    </>
  );
}

function AssetConfigurePanel({
  asset,
  draft,
  setDraft,
  dirty,
  saving,
  deleting,
  message,
  onSubmit,
  onReset,
  onDelete,
}: {
  asset: AssetLibraryItem;
  draft: AssetDraft;
  setDraft: Dispatch<SetStateAction<AssetDraft>>;
  dirty: boolean;
  saving: boolean;
  deleting: boolean;
  message: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const update = (patch: Partial<AssetDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <form onSubmit={onSubmit} className="flex min-h-full flex-1 flex-col">
      <ContextPanelBody>
        <div className="grid gap-3 border-b border-border/60 p-4">
          <AssetPreview asset={asset} />
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold leading-snug">
              {asset.displayName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)} · Added{" "}
              {formatDate(asset.createdAt)}
            </p>
          </div>
          <div className={cn("grid gap-2", asset.kind === "file" ? "grid-cols-2" : "grid-cols-3")}>
            {asset.kind !== "file" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink data-icon="inline-start" />
                Open
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => downloadAsset(asset)}>
              <Download data-icon="inline-start" />
              Download
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyWithToast(asset.markdown, "Embed")}
            >
              <Copy data-icon="inline-start" />
              Embed
            </Button>
          </div>
        </div>

        <ContextPanelSection
          icon={PenLine}
          title="Details"
          description="How it is labelled in documents and the gallery."
        >
          <PanelField label="Display name">
            <Input
              value={draft.displayName}
              onChange={(event) => update({ displayName: event.target.value })}
            />
          </PanelField>
          {asset.kind === "image" ? (
            <PanelField label="Alt text" hint="Read aloud by screen readers in place of the image.">
              <Input
                value={draft.altText}
                onChange={(event) => update({ altText: event.target.value })}
              />
            </PanelField>
          ) : null}
          <PanelField label="Description">
            <Textarea
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
              rows={3}
              placeholder="Optional"
            />
          </PanelField>
        </ContextPanelSection>

        <ContextPanelSection
          icon={Tags}
          title="Tags"
          description="Separate with spaces; underscores join words."
        >
          <TagAutocompleteInput
            value={draft.tags}
            onChange={(value) => update({ tags: value })}
            placeholder="photos travel_2026"
            inputClassName="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          />
        </ContextPanelSection>

        <ContextPanelSection
          icon={draft.visibility === "public" ? Globe2 : Lock}
          title="Visibility"
        >
          <div className="grid gap-2" role="radiogroup" aria-label="Visibility">
            <VisibilityOption
              active={draft.visibility === "private"}
              icon={Lock}
              label="Private"
              detail="Only you, and readers of documents that embed it."
              onClick={() => update({ visibility: "private" })}
            />
            <VisibilityOption
              active={draft.visibility === "public"}
              icon={Globe2}
              label="Public"
              detail="Anyone with the link; listed in the gallery."
              onClick={() => update({ visibility: "public" })}
            />
          </div>
        </ContextPanelSection>

        <ContextPanelSection
          icon={Code2}
          title="Embed"
          description="Paste into any document."
          action={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void copyWithToast(asset.markdown, "Embed")}
            >
              <Copy data-icon="inline-start" />
              Copy
            </Button>
          }
        >
          <code className="block rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[0.72rem] leading-relaxed text-foreground [overflow-wrap:anywhere]">
            {asset.markdown}
          </code>
        </ContextPanelSection>

        <ContextPanelSection
          icon={Trash2}
          tone="danger"
          title="Delete"
          description="Removes it from documents, the library, the gallery, and storage."
        >
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 data-icon="inline-start" />
            {deleting ? "Deleting…" : "Delete asset"}
          </Button>
        </ContextPanelSection>
      </ContextPanelBody>

      <div className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur">
        <p
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            dirty ? "text-foreground" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {message ?? (dirty ? "Unsaved changes" : "All changes saved")}
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={onReset}>
          Reset
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function AssetThumbnail({ asset }: { asset: AssetLibraryItem }) {
  if (asset.kind === "image") {
    return (
      <span className="block bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.altText ?? asset.displayName}
          className="h-auto w-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }

  return <FileTile asset={asset} className="aspect-[4/3]" />;
}

function AssetPreview({ asset }: { asset: AssetLibraryItem }) {
  if (asset.kind === "image") {
    return (
      <div className="grid max-h-64 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.altText ?? asset.displayName}
          className="max-h-64 w-full object-contain"
        />
      </div>
    );
  }

  return <FileTile asset={asset} className="h-36 rounded-md border border-border/60" />;
}

function FileTile({ asset, className }: { asset: AssetLibraryItem; className?: string }) {
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

function PanelField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[0.7rem] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="h-9 w-32 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/70 bg-card/60 px-3 py-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function StorageBar({ used, quota }: { used: number; quota: number }) {
  const ratio = quota > 0 ? Math.min(used / quota, 1) : 0;
  const percent = Math.round(ratio * 100);
  const nearLimit = ratio >= 0.9;

  return (
    <div className="grid gap-1.5 rounded-md border border-border/70 bg-card/60 px-3 py-2.5">
      <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span className="font-semibold uppercase tracking-[0.18em]">Storage</span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            nearLimit ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="text-[0.7rem] text-muted-foreground">
        {formatBytes(used)} of {quota > 0 ? formatBytes(quota) : "unlimited"} used
      </p>
    </div>
  );
}

function VisibilityIcon({ visibility }: { visibility: "private" | "public" }) {
  const Icon = visibility === "public" ? Globe2 : Lock;
  const label = visibility === "public" ? "Public" : "Private";

  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border",
        visibility === "public"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground",
      )}
      title={label}
    >
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function VisibilityOption({
  active,
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  icon: typeof Lock;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-border/70 hover:border-border hover:bg-muted/50",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function sameDraft(a: AssetDraft, b: AssetDraft) {
  return (
    a.displayName === b.displayName &&
    a.altText === b.altText &&
    a.description === b.description &&
    a.visibility === b.visibility &&
    a.tags.trim().split(/\s+/).join(" ") === b.tags.trim().split(/\s+/).join(" ")
  );
}

function formatDate(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toDraft(asset: AssetLibraryItem | null): AssetDraft {
  return {
    displayName: asset?.displayName ?? "",
    altText: asset?.altText ?? "",
    description: asset?.description ?? "",
    visibility: asset?.visibility ?? "private",
    tags: asset?.tags?.join(" ") ?? "",
  };
}

function summarizeStorage(assets: AssetLibraryItem[]) {
  return {
    bytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
  };
}

function filterAndSortAssets(
  assets: AssetLibraryItem[],
  filters: {
    query: ReturnType<typeof parseContentSearchQuery>;
    kind: KindFilter;
    visibility: VisibilityFilter;
    sort: SortMode;
  },
) {
  return assets
    .filter((asset) => {
      if (filters.kind !== "all" && asset.kind !== filters.kind) {
        return false;
      }

      if (
        filters.visibility !== "all" &&
        asset.visibility !== filters.visibility
      ) {
        return false;
      }

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
    })
    .sort((first, second) => {
      if (filters.sort === "oldest") {
        return dateValue(first.createdAt) - dateValue(second.createdAt);
      }

      if (filters.sort === "name") {
        return first.displayName.localeCompare(second.displayName);
      }

      if (filters.sort === "size") {
        return second.sizeBytes - first.sizeBytes;
      }

      return dateValue(second.createdAt) - dateValue(first.createdAt);
    });
}

function dateValue(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function AssetKindIcon({
  kind,
  className,
}: {
  kind: AssetLibraryItem["kind"];
  className?: string;
}) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf") return <FileText className={className} />;
  return <FileIcon className={className} />;
}
