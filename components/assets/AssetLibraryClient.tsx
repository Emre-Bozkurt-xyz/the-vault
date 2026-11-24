"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { RenditionImage } from "@/components/assets/RenditionImage";
import { moveAssetsToBin } from "@/components/assets/asset-bin-actions";
import {
  assetExtensionBadge,
  assetTypeLabel,
  copyWithToast,
  downloadAsset,
} from "@/components/assets/asset-ui";
import { UploadProgressList } from "@/components/assets/UploadProgressList";
import { useAssetUploads } from "@/components/assets/useAssetUploads";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { WithContextMenu } from "@/components/ui/use-context-menu";
import { TagAutocompleteInput } from "@/components/tag-autocomplete-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ContextPanelBody,
  ContextPanelSection,
} from "@/components/workspace/ContextPanel";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { dispatchAssetsChanged, subscribeToAssetsChanged } from "@/lib/asset-events";
import { fetchAssetLibrary } from "@/lib/shared-request";
import {
  requestCloseRightPanel,
  requestOpenRightPanel,
} from "@/lib/document-command-events";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
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
  /** The original. Open, download and copy-link use it; grids never do. */
  url: string;
  /** Grid-sized WebP (`?r=thumb`), or null when the asset has no renditions. */
  thumbUrl: string | null;
  /** Panel/viewer-sized WebP (`?r=display`), or null likewise. */
  displayUrl: string | null;
  /** Displayed pixel size, once known (filled when renditions are made). */
  width: number | null;
  height: number | null;
  markdown: string;
};

type MediaFields = "kind" | "altText" | "displayName" | "mimeType" | "width" | "height";

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
  // Filters and the selected asset live in the URL, so the assets side panel
  // and links can open the library in a given view (`?kind=image`,
  // `?visibility=public`, `?asset=<id>`). Search text and sort stay local.
  const searchParams = useSearchParams();
  const kindFilter = parseKindFilter(searchParams.get("kind"));
  const visibilityFilter = parseVisibilityFilter(searchParams.get("visibility"));
  const selectedId = searchParams.get("asset");
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const storage = useMemo(() => summarizeStorage(assets), [assets]);

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
    // Refreshes this page and the side panel alike.
    onSettled: () => dispatchAssetsChanged(),
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

  const refreshAssets = useCallback(async () => {
    try {
      const payload = (await fetchAssetLibrary()) as {
        assets?: AssetLibraryItem[];
      } | null;
      if (payload?.assets) setAssets(payload.assets);
    } catch {
      // Keep the list we have.
    }
  }, []);

  useEffect(() => subscribeToAssetsChanged(() => void refreshAssets()), [refreshAssets]);

  // A click on empty page space deselects the asset and collapses the details
  // panel, like a file manager's background click. Cards, controls, text
  // selections, and the click that only dismissed an open menu don't count;
  // neither do clicks in the side panels (outside `main`).
  useEffect(() => {
    let menuWasOpen = false;
    const onPointerDown = () => {
      menuWasOpen =
        document.querySelector('[data-slot="dropdown-menu-content"]') !== null;
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

      if (new URLSearchParams(window.location.search).has("asset")) {
        updateLibraryUrl({ asset: null });
      }
      requestCloseRightPanel();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const removeFromLibrary = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setAssets((current) => current.filter((asset) => !ids.includes(asset.id)));
    const selectedNow = new URLSearchParams(window.location.search).get("asset");
    if (selectedNow && ids.includes(selectedNow)) updateLibraryUrl({ asset: null });
  }, []);

  const moveToBin = useCallback(
    async (asset: AssetLibraryItem) => removeFromLibrary(await moveAssetsToBin([asset])),
    [removeFromLibrary],
  );

  // Delete / Backspace moves the selected asset to the Bin, as in a file
  // manager. Reversible (Undo toast), so no confirmation; ignored while typing.
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [role='dialog']"))
      ) {
        return;
      }
      event.preventDefault();
      void moveToBin(selected);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveToBin, selected]);

  function selectAsset(asset: AssetLibraryItem) {
    updateLibraryUrl({ asset: asset.id });

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
      uploads.enqueue(files);
    }
  }

  return (
    <>
      <WorkspacePageRegistration
        page={ASSETS_PAGE}
        rightPanel={panelSlot}
        rightPanelTitle="Asset"
      />

      {/* Container queries: the space this page gets depends on which side
          panels are open, so breakpoints follow the page, not the window.
          The explicit `minmax(0,1fr)` column matters: an implicit `auto` track
          never shrinks below its content's min-content width, and the
          multi-column card grid reports that as roughly (columns × the
          longest unbroken filename), which pushed the page past its column. */}
      <div className="@container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <header className="flex flex-col gap-5 border-b border-border/70 pb-6 @3xl:flex-row @3xl:items-end @3xl:justify-between">
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
          <div className="grid w-full grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2 text-sm @3xl:w-[22rem] @3xl:shrink-0">
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
              onChange={(value) => updateLibraryUrl({ kind: value === "all" ? null : value })}
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
              onChange={(value) =>
                updateLibraryUrl({ visibility: value === "all" ? null : value })
              }
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
            <Link
              href="/assets?view=bin"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
              aria-label="Open the Bin"
              title="Bin"
            >
              <Trash2 />
            </Link>
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
          className="@xl:grid-cols-2 @5xl:grid-cols-3"
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
          <div className="min-w-0 columns-1 gap-4 @sm:columns-2 @2xl:columns-3 @5xl:columns-4 @7xl:columns-5">
            {visibleAssets.map((asset) => (
              <WithContextMenu key={asset.id}>
                {(menu) => (
                  <div
                    data-asset-card
                    onContextMenu={menu.onContextMenu}
                    className="group relative mb-4 break-inside-avoid"
                  >
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
                      contextMenu={menu}
                      className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <DropdownMenuItem onClick={() => selectAsset(asset)}>
                        <SlidersHorizontal /> Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void moveToBin(asset)}
                      >
                        <Trash2 /> Move to Bin
                      </DropdownMenuItem>
                    </AssetActionsMenu>
                  </div>
                )}
              </WithContextMenu>
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
                onSaved={(saved) => {
                  setAssets((current) =>
                    current.map((asset) => (asset.id === saved.id ? saved : asset)),
                  );
                  dispatchAssetsChanged();
                }}
                onMoveToBin={() => void moveToBin(selected)}
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
  onSaved,
  onMoveToBin,
}: {
  asset: AssetLibraryItem;
  onSaved: (asset: AssetLibraryItem) => void;
  onMoveToBin: () => void;
}) {
  // Keyed by asset id, so switching assets starts a fresh draft.
  const [draft, setDraft] = useState<AssetDraft>(() => toDraft(asset));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = !sameDraft(draft, toDraft(asset));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/assets/${asset.id}`, {
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

      setDraft(toDraft(payload.asset));
      setMessage("Saved.");
      onSaved(payload.asset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save asset.");
    } finally {
      setSaving(false);
    }
  }

  function onReset() {
    setDraft(toDraft(asset));
    setMessage(null);
  }

  const update = (patch: Partial<AssetDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex min-h-full flex-1 flex-col">
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
          title="Move to Bin"
          description={`Hidden everywhere it appears, and deleted for good after ${ASSET_LIMITS.binRetentionDays} days unless you restore it. Documents show a placeholder meanwhile.`}
        >
          <Button type="button" variant="destructive" size="sm" onClick={onMoveToBin}>
            <Trash2 data-icon="inline-start" />
            Move to Bin
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

export function AssetThumbnail({
  asset,
}: {
  asset: Pick<AssetLibraryItem, MediaFields | "thumbUrl">;
}) {
  const tile = <FileTile asset={asset} className="aspect-[4/3]" />;

  if (asset.kind !== "image") return tile;

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

export function AssetPreview({
  asset,
}: {
  asset: Pick<AssetLibraryItem, MediaFields | "displayUrl">;
}) {
  const tile = <FileTile asset={asset} className="h-36 rounded-md border border-border/60" />;

  if (asset.kind !== "image") return tile;

  return (
    <div className="grid max-h-64 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/40">
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

function FileTile({
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

function parseKindFilter(value: string | null): KindFilter {
  return value === "image" || value === "pdf" || value === "file" ? value : "all";
}

function parseVisibilityFilter(value: string | null): VisibilityFilter {
  return value === "private" || value === "public" ? value : "all";
}

/**
 * Shallow URL update: Next keeps `useSearchParams` in sync with
 * `history.replaceState`, so filters and selection change without a server
 * round trip, yet stay linkable and survive a reload.
 */
/** Targets a background click must not treat as "empty space". */
const backgroundClickIgnore =
  "[data-asset-card], a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='option'], [role='combobox'], [role='listbox']";

function updateLibraryUrl(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  // `null` state, not `history.state`: Next marks its own entries there, and a
  // call carrying those markers is treated as internal and never synced.
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
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
