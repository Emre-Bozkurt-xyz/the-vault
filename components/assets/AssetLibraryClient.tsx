"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  Check,
  Copy,
  Eye,
  FileText,
  Globe2,
  ImageIcon,
  Lock,
  PanelRightOpen,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { TagAutocompleteInput } from "@/components/tag-autocomplete-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getContentSearchSummary,
  matchesContentSearchQuery,
  parseContentSearchQuery,
} from "@/lib/content-search-query";
import { cn } from "@/lib/utils";

export type AssetLibraryItem = {
  id: string;
  kind: "image" | "pdf";
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
type KindFilter = "all" | "image" | "pdf";
type VisibilityFilter = "all" | "private" | "public";
type SortMode = "newest" | "oldest" | "name" | "size";

export function AssetLibraryClient({
  initialAssets,
}: {
  initialAssets: AssetLibraryItem[];
}) {
  const [assets, setAssets] = useState(initialAssets);
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
  const parsedQuery = useMemo(() => parseContentSearchQuery(query), [query]);
  const querySummary = useMemo(
    () => getContentSearchSummary(parsedQuery),
    [parsedQuery],
  );
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
  }

  async function copyEmbed(asset: AssetLibraryItem) {
    await navigator.clipboard.writeText(asset.markdown);
    setMessage("Embed copied.");
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
    <div className="grid min-h-full gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0">
        <div className="flex flex-col gap-5 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
              Asset library
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Content
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Private uploads used by your documents. Publish an asset only when
              it should be visible outside private docs.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:min-w-64">
            <Metric label="Assets" value={String(assets.length)} />
            <Metric label="Stored" value={formatBytes(storage.bytes)} />
          </div>
        </div>

        {assets.length > 0 ? (
          <div className="mt-5 grid gap-3 border-b border-border/50 pb-5 lg:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, tags, @user, kind:image..."
                className="pl-9"
              />
            </label>
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as KindFilter)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none"
              aria-label="Filter by asset type"
            >
              <option value="all">All types</option>
              <option value="image">Images</option>
              <option value="pdf">PDFs</option>
            </select>
            <select
              value={visibilityFilter}
              onChange={(event) =>
                setVisibilityFilter(event.target.value as VisibilityFilter)
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none"
              aria-label="Filter by visibility"
            >
              <option value="all">All visibility</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none"
              aria-label="Sort assets"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>
        ) : null}
        {querySummary.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
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
          <div className="mt-6 columns-1 gap-4 sm:columns-2 xl:columns-3">
            {visibleAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => selectAsset(asset)}
                className={cn(
                  "mb-4 inline-block w-full break-inside-avoid overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg",
                  selected?.id === asset.id
                    ? "border-primary/70 ring-1 ring-primary/35"
                    : "border-border/70",
                )}
              >
                {asset.kind === "image" ? (
                  <span className="block bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt={asset.altText ?? asset.displayName}
                      className="h-auto w-full object-cover"
                      loading="lazy"
                    />
                  </span>
                ) : (
                  <span className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-muted-foreground">
                    <FileText className="size-10" />
                  </span>
                )}
                <span className="block p-3">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {asset.displayName}
                    </span>
                    <VisibilityBadge visibility={asset.visibility} />
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    {asset.kind === "image" ? (
                      <ImageIcon className="size-3.5" />
                    ) : (
                      <FileText className="size-3.5" />
                    )}
                    {asset.mimeType} - {formatBytes(asset.sizeBytes)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : assets.length > 0 ? (
          <div className="mt-6 border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
            <Search className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No matching assets</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Clear the search or filters to see the rest of your library.
            </p>
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-border/80 bg-card/45 px-5 py-12 text-center">
            <ImageIcon className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No assets yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Open a document, use the image upload button in the Markdown
              toolbar, then come back here to browse and configure the upload.
            </p>
          </div>
        )}
      </section>

      <aside className="min-h-0 border border-border/70 bg-card/70 lg:sticky lg:top-6 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto">
        {selected ? (
          <form onSubmit={saveAsset} className="flex h-full flex-col">
            <div className="border-b border-border/70 p-4">
              <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <PanelRightOpen className="size-3.5" />
                Configure
              </p>
              <h2 className="mt-2 truncate text-lg font-semibold">
                {selected.displayName}
              </h2>
            </div>
            <div className="grid gap-4 p-4">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Display name</span>
                <Input
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Alt text</span>
                <Input
                  value={draft.altText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      altText: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Tags</span>
                <TagAutocompleteInput
                  value={draft.tags}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      tags: value,
                    }))
                  }
                  placeholder="tag1 tag2 ..."
                  inputClassName="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  Separate tags with spaces. Use underscores for multi-word tags.
                </span>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Description</span>
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={4}
                />
              </label>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Visibility</span>
                <div className="grid grid-cols-2 gap-2">
                  <VisibilityButton
                    active={draft.visibility === "private"}
                    icon={Lock}
                    label="Private"
                    onClick={() =>
                      setDraft((current) => ({ ...current, visibility: "private" }))
                    }
                  />
                  <VisibilityButton
                    active={draft.visibility === "public"}
                    icon={Globe2}
                    label="Public"
                    onClick={() =>
                      setDraft((current) => ({ ...current, visibility: "public" }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2 rounded-md border border-border/70 bg-background/55 p-3 text-xs text-muted-foreground">
                <p className="font-mono text-[0.72rem] text-foreground">
                  {selected.markdown}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyEmbed(selected)}
                  >
                    <Copy data-icon="inline-start" />
                    Copy embed
                  </Button>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                  >
                    <Eye data-icon="inline-start" />
                    Open
                  </a>
                </div>
              </div>
            </div>
            <div className="mt-auto border-t border-border/70 p-4">
              {message ? (
                <p className="mb-3 text-sm text-muted-foreground">{message}</p>
              ) : null}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? (
                  <Save data-icon="inline-start" />
                ) : (
                  <Check data-icon="inline-start" />
                )}
                {saving ? "Saving..." : "Save asset"}
              </Button>
              <Button
                type="button"
                className="mt-2 w-full"
                variant="outline"
                disabled={deleting}
                onClick={() => void deleteSelectedAsset()}
              >
                <Trash2 data-icon="inline-start" />
                {deleting ? "Deleting..." : "Delete asset"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Select an asset to configure it.
          </div>
        )}
      </aside>
    </div>
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

function VisibilityBadge({
  visibility,
}: {
  visibility: "private" | "public";
}) {
  return (
    <Badge variant={visibility === "public" ? "secondary" : "outline"}>
      {visibility === "public" ? "Public" : "Private"}
    </Badge>
  );
}

function VisibilityButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Lock;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition",
        active
          ? "border-primary/70 bg-primary/10 text-foreground"
          : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
