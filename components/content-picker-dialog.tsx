"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileText, Image as ImageIcon, Loader2, Search, X } from "lucide-react";

import {
  listPublicAssetsForPickerAction,
  listUserAssetsForPickerAction,
  type PickerAsset,
} from "@/server/asset-picker-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AssetKind } from "@/db/schema";
import { cn } from "@/lib/utils";

const INCLUDE_PUBLIC_KEY = "vault:picker:include-public";

type ContentPickerFilter = {
  kinds?: AssetKind[];
};

type ContentPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: PickerAsset) => void;
  filter?: ContentPickerFilter;
  title?: string;
};

type KindTab = "all" | AssetKind;

export function ContentPickerDialog({
  open,
  onOpenChange,
  onSelect,
  filter,
  title = "Asset library",
}: ContentPickerDialogProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeKind, setActiveKind] = useState<KindTab>("all");
  const [includePublic, setIncludePublic] = useState(false);
  const [myAssets, setMyAssets] = useState<PickerAsset[]>([]);
  const [publicAssets, setPublicAssets] = useState<PickerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Restore persisted toggle on mount
  useEffect(() => {
    try {
      setIncludePublic(localStorage.getItem(INCLUDE_PUBLIC_KEY) === "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 280);
    return () => clearTimeout(timer);
  }, [search]);

  // Determine which kind tabs to show
  const allowedKinds = filter?.kinds;
  const showTabs =
    !allowedKinds || allowedKinds.length === 0 || allowedKinds.length > 1;
  const availableTabs: KindTab[] = useMemo(() => {
    if (!allowedKinds || allowedKinds.length === 0) {
      return ["all", "image", "pdf"];
    }
    return allowedKinds.length > 1 ? ["all", ...allowedKinds] : allowedKinds;
  }, [allowedKinds]);

  const queryKinds: AssetKind[] | undefined = useMemo(() => {
    if (activeKind === "all") return allowedKinds;
    return [activeKind];
  }, [activeKind, allowedKinds]);

  // Fetch assets
  const fetchAssets = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    try {
      const queries: Promise<PickerAsset[]>[] = [
        listUserAssetsForPickerAction({
          kinds: queryKinds,
          query: debouncedSearch || undefined,
        }),
      ];

      if (includePublic) {
        queries.push(
          listPublicAssetsForPickerAction({
            kinds: queryKinds,
            query: debouncedSearch || undefined,
          }),
        );
      }

      const [mine, pub = []] = await Promise.all(queries);

      if (controller.signal.aborted) return;

      setMyAssets(mine);
      setPublicAssets(pub);
    } catch {
      if (!controller.signal.aborted) {
        setMyAssets([]);
        setPublicAssets([]);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [queryKinds, debouncedSearch, includePublic]);

  useEffect(() => {
    if (!open) return;
    void fetchAssets();
  }, [open, fetchAssets]);

  // Merge and deduplicate public assets
  const allAssets = useMemo(() => {
    if (!includePublic) return myAssets;
    const seen = new Set(myAssets.map((a) => a.id));
    const extra = publicAssets.filter((a) => !seen.has(a.id));
    return [...myAssets, ...extra];
  }, [myAssets, publicAssets, includePublic]);

  function handleSelect(asset: PickerAsset) {
    onSelect(asset);
    onOpenChange(false);
  }

  function toggleIncludePublic() {
    const next = !includePublic;
    setIncludePublic(next);
    try {
      localStorage.setItem(INCLUDE_PUBLIC_KEY, String(next));
    } catch {
      // ignore
    }
  }

  const hasImages = allAssets.some((a) => a.kind === "image");
  const hasPdfs = allAssets.some((a) => a.kind === "pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90svh,56rem)] w-full max-w-[min(calc(100vw-2rem),54rem)] sm:max-w-[54rem] flex-col gap-0 overflow-hidden p-0 sm:rounded-md"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <label htmlFor={searchId} className="sr-only">
                Search assets
              </label>
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                autoComplete="off"
                className="h-7 w-full rounded border border-border/60 bg-muted/40 pl-7 pr-2 text-xs outline-none transition focus:border-primary/50 focus:bg-background"
              />
            </div>
            <DialogClose
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close picker"
            >
              <X className="size-3.5" />
            </DialogClose>
          </div>

          {/* Tab row + public toggle */}
          <div className="mt-2.5 flex items-center gap-3">
            {showTabs && availableTabs.length > 1 ? (
              <div className="flex items-center gap-0.5">
                {availableTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveKind(tab)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition",
                      activeKind === tab
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {tab === "all" ? "All" : tab === "image" ? "Images" : "Files"}
                  </button>
                ))}
              </div>
            ) : (
              <div />
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[0.7rem] text-muted-foreground">
                Include public
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={includePublic}
                onClick={toggleIncludePublic}
                className={cn(
                  "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                  includePublic ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none block size-3 rounded-full bg-white shadow-sm ring-0 transition-transform",
                    includePublic ? "translate-x-3" : "translate-x-0",
                  )}
                />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Asset grid */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : allAssets.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {debouncedSearch
                ? `No assets match "${debouncedSearch}".`
                : "No assets yet."}
            </div>
          ) : (
            <div className="space-y-5">
              {(activeKind === "all" || activeKind === "image") && hasImages && (
                <AssetSection>
                  {activeKind === "all" && hasPdfs ? (
                    <SectionLabel>Images</SectionLabel>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {allAssets
                      .filter((a) => a.kind === "image")
                      .map((asset) => (
                        <ImageTile
                          key={asset.id}
                          asset={asset}
                          onSelect={handleSelect}
                        />
                      ))}
                  </div>
                </AssetSection>
              )}

              {(activeKind === "all" || activeKind === "pdf") && hasPdfs && (
                <AssetSection>
                  {activeKind === "all" && hasImages ? (
                    <SectionLabel>Files</SectionLabel>
                  ) : null}
                  <div className="grid gap-1">
                    {allAssets
                      .filter((a) => a.kind === "pdf")
                      .map((asset) => (
                        <FileTile
                          key={asset.id}
                          asset={asset}
                          onSelect={handleSelect}
                        />
                      ))}
                  </div>
                </AssetSection>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetSection({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

function ImageTile({
  asset,
  onSelect,
}: {
  asset: PickerAsset;
  onSelect: (asset: PickerAsset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(asset)}
      className="group relative aspect-square overflow-hidden rounded border border-border/50 bg-muted/40 transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/assets/${asset.id}/content`}
        alt={asset.displayName}
        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        loading="lazy"
      />
      <span className="absolute inset-x-0 bottom-0 translate-y-full bg-black/65 px-1.5 py-1 text-[0.65rem] leading-tight text-white transition-transform group-hover:translate-y-0">
        {asset.displayName}
      </span>
    </button>
  );
}

function FileTile({
  asset,
  onSelect,
}: {
  asset: PickerAsset;
  onSelect: (asset: PickerAsset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(asset)}
      className="flex w-full items-center gap-3 rounded border border-border/50 bg-card/30 px-3 py-2 text-left transition hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {asset.displayName}
        </span>
        <span className="block text-[0.68rem] text-muted-foreground">
          {asset.mimeType} · {formatBytes(asset.sizeBytes)}
        </span>
      </span>
      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}
