"use client";

import {
  ArrowDownUp,
  ChevronDown,
  Filter,
  FolderPlus,
  FolderUp,
  Info,
  LayoutDashboard,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";

import { SORT_LABELS, VIEW_LABELS } from "@/components/assets/LibraryMenus";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  MEDIA_SORTS,
  MEDIA_VIEWS,
  isPhotoView,
  type MediaSort,
  type MediaView,
} from "@/lib/media-library";
import { cn } from "@/lib/utils";

export type KindFilter = "all" | "image" | "pdf" | "video" | "file";

export const KIND_LABELS: Record<KindFilter, string> = {
  all: "All types",
  image: "Images",
  video: "Videos",
  pdf: "PDFs",
  file: "Other files",
};

const VIEW_ICONS: Record<MediaView, typeof LayoutGrid> = {
  masonry: LayoutDashboard,
  grid: LayoutGrid,
  list: List,
  details: Rows3,
};

const menuButton = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "h-9 gap-1.5 px-2.5 data-[popup-open]:bg-muted",
);

/** What "New" offers, from the toolbar button or the phone's floating button. */
function NewMenuItems({
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
}: {
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onNewFolder: () => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={onUploadFiles}>
          <Upload /> Upload files
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onUploadFolder}>
          <FolderUp /> Upload folder
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={onNewFolder}>
          <FolderPlus /> New folder
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

/**
 * New on a phone: a floating button bottom-right, above the nav bar, where a
 * thumb rests (the toolbar's own New is hidden there). The page hides it
 * while selecting, so the selection bar gets the full width.
 */
export function NewFloatingButton({
  uploading,
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
}: {
  uploading: boolean;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onNewFolder: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="New"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-black/30 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:hidden"
      >
        {uploading ? <Loader2 className="size-6 animate-spin" /> : <Plus className="size-6" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-48">
        <NewMenuItems onUploadFiles={onUploadFiles} onUploadFolder={onUploadFolder} onNewFolder={onNewFolder} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One row: search, then how you're looking (Filter, Sort, View), the Details
 * toggle, and New. On a phone that's search, one "View options" menu holding
 * Filter, Sort and View, and Details; New floats bottom-right instead
 * (`NewFloatingButton`). Active filters show as removable chips underneath.
 */
export function LibraryToolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  chips,
  sort,
  onSortChange,
  view,
  onViewChange,
  showNames,
  onShowNamesChange,
  detailsOpen,
  onToggleDetails,
  canAdd,
  uploading,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  /** Removable filter chips (type, a legacy visibility link, search terms). */
  chips: { key: string; label: string; onRemove?: () => void }[];
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
  showNames: boolean;
  onShowNamesChange: (showNames: boolean) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  canAdd: boolean;
  uploading: boolean;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}) {
  const ViewIcon = VIEW_ICONS[view];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-40 sm:min-w-[11rem] sm:basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search the library</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                onQueryChange("");
              }
            }}
            placeholder="Search all folders…"
            className="h-9 pl-9"
          />
        </label>

        <div className="flex items-center gap-1.5">
          {/* Phones: one button for how you're looking. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="View options"
              className={cn(menuButton, "relative size-9 px-0 sm:hidden", kind !== "all" && "border-primary/50")}
            >
              <SlidersHorizontal className="size-4" />
              {kind !== "all" ? (
                <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Filter /> Type
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{KIND_LABELS[kind]}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuRadioGroup value={kind} onValueChange={(value) => onKindChange(value as KindFilter)}>
                      {(Object.keys(KIND_LABELS) as KindFilter[]).map((option) => (
                        <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                          {KIND_LABELS[option]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ArrowDownUp /> Sort
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{SORT_LABELS[sort]}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as MediaSort)}>
                      {MEDIA_SORTS.map((option) => (
                        <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                          {SORT_LABELS[option]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ViewIcon /> View
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{VIEW_LABELS[view]}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-40">
                    <DropdownMenuRadioGroup value={view} onValueChange={(value) => onViewChange(value as MediaView)}>
                      {MEDIA_VIEWS.map((option) => {
                        const Icon = VIEW_ICONS[option];
                        return (
                          <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                            <Icon /> {VIEW_LABELS[option]}
                          </DropdownMenuRadioItem>
                        );
                      })}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={showNames}
                  disabled={!isPhotoView(view)}
                  onCheckedChange={(checked) => onShowNamesChange(checked)}
                >
                  Show names
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(menuButton, "max-sm:hidden", kind !== "all" && "border-primary/50 text-foreground")}
              aria-label="Filter"
            >
              <Filter className="size-4" />
              <span className="hidden @2xl:inline">{kind === "all" ? "Filter" : KIND_LABELS[kind]}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Type</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={kind} onValueChange={(value) => onKindChange(value as KindFilter)}>
                  {(Object.keys(KIND_LABELS) as KindFilter[]).map((option) => (
                    <DropdownMenuRadioItem key={option} value={option}>
                      {KIND_LABELS[option]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(menuButton, "max-sm:hidden")} aria-label={`Sort: ${SORT_LABELS[sort]}`}>
              <ArrowDownUp className="size-4" />
              <span className="hidden @2xl:inline">{SORT_LABELS[sort]}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as MediaSort)}>
                  {MEDIA_SORTS.map((option) => (
                    <DropdownMenuRadioItem key={option} value={option}>
                      {SORT_LABELS[option]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(menuButton, "max-sm:hidden")} aria-label={`View: ${VIEW_LABELS[view]}`}>
              <ViewIcon className="size-4" />
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={view} onValueChange={(value) => onViewChange(value as MediaView)}>
                  {MEDIA_VIEWS.map((option) => {
                    const Icon = VIEW_ICONS[option];
                    return (
                      <DropdownMenuRadioItem key={option} value={option}>
                        <Icon /> {VIEW_LABELS[option]}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={showNames}
                  disabled={!isPhotoView(view)}
                  onCheckedChange={(checked) => onShowNamesChange(checked)}
                >
                  Show names
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={onToggleDetails}
            aria-pressed={detailsOpen}
            aria-label="Details (I)"
            title="Details (I)"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-9",
              detailsOpen && "bg-muted text-foreground",
            )}
          >
            <Info className="size-4" />
          </button>

          {canAdd ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(buttonVariants({ size: "sm" }), "h-9 gap-1.5 pl-2.5 pr-3 max-sm:hidden")}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                New
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <NewMenuItems onUploadFiles={onUploadFiles} onUploadFolder={onUploadFolder} onNewFolder={onNewFolder} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {chips.map((chip) =>
            chip.onRemove ? (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card py-0.5 pl-2.5 pr-1.5 transition hover:border-border hover:bg-muted"
                aria-label={`Remove filter: ${chip.label}`}
              >
                {chip.label}
                <X className="size-3 text-muted-foreground" />
              </button>
            ) : (
              <span key={chip.key} className="rounded-full border border-border/70 bg-card px-2.5 py-0.5 text-muted-foreground">
                {chip.label}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
