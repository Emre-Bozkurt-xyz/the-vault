"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Folder, Loader2, MoreHorizontal, MousePointerClick, X } from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { AssetPreview } from "@/components/assets/AssetPreviews";
import { folderSummary } from "@/components/assets/FolderTiles";
import { formatDay, formatDuration } from "@/components/assets/MediaItemViews";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetTypeLabel } from "@/components/assets/asset-ui";
import { TagAutocompleteInput } from "@/components/tag-autocomplete-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format";
import { showWorkspaceToast } from "@/lib/workspace-toast";
import { cn } from "@/lib/utils";

/**
 * The library's Details panel (docs/26 §7): opened on demand, it follows the
 * selection. One file shows its preview and facts, with name, tags, alt text
 * and description editable in place (saved as you go); a folder, several
 * items, or nothing selected (the place itself) get a short summary.
 * Actions live in the "⋯" menu, the same items as the right-click menu.
 */

type AssetFields = Pick<
  AssetLibraryItem,
  "displayName" | "altText" | "description" | "visibility" | "tags"
>;

export function AssetDetails({
  asset,
  folderName,
  linked,
  menu,
  onView,
  onOpenFolder,
  onShare,
  onSaved,
}: {
  asset: AssetLibraryItem;
  /** Where it lives; null = the library root. */
  folderName: string | null;
  /** Has a working share link. */
  linked: boolean;
  /** The "⋯" menu's items. */
  menu: ReactNode;
  onView: () => void;
  onOpenFolder: () => void;
  onShare: () => void;
  onSaved: (asset: AssetLibraryItem) => void;
}) {
  // Local drafts follow the asset while untouched, so a rename from the menu
  // or a refresh shows up, but never overwrite what is being typed.
  const [name, setName] = useState(asset.displayName);
  const [alt, setAlt] = useState(asset.altText ?? "");
  const [description, setDescription] = useState(asset.description ?? "");
  const [tags, setTags] = useState(asset.tags);
  const [tagDraft, setTagDraft] = useState("");
  // Open from the start when there is something in it; then it's the user's.
  const [foldStartsOpen] = useState(Boolean(asset.altText || asset.description));
  const [seen, setSeen] = useState(asset);
  if (asset !== seen) {
    if (name === seen.displayName) setName(asset.displayName);
    if (alt === (seen.altText ?? "")) setAlt(asset.altText ?? "");
    if (description === (seen.description ?? "")) setDescription(asset.description ?? "");
    if (sameTags(tags, seen.tags)) setTags(asset.tags);
    setSeen(asset);
  }

  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Saves run one at a time, each on top of the last saved state, so quick
  // edits to two fields can't undo each other.
  const server = useRef<AssetFields>(asset);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  useEffect(() => {
    server.current = asset;
  }, [asset]);

  function save(patch: Partial<AssetFields>) {
    pending.current += 1;
    setStatus("saving");
    queue.current = queue.current
      .then(async () => {
        const base = server.current;
        const body = {
          displayName: base.displayName,
          altText: base.altText ?? "",
          description: base.description ?? "",
          visibility: base.visibility,
          tags: base.tags,
          ...patch,
        };
        const response = await fetch(`/api/assets/${asset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as {
          asset?: AssetLibraryItem;
          error?: string;
        } | null;
        if (!response.ok || !payload?.asset) throw new Error(payload?.error ?? "Could not save.");
        server.current = payload.asset;
        if ("tags" in patch) setTags(payload.asset.tags);
        onSaved(payload.asset);
      })
      .catch((error: unknown) => {
        // Put the edited fields back to what is saved.
        const saved = server.current;
        if ("displayName" in patch) setName(saved.displayName);
        if ("altText" in patch) setAlt(saved.altText ?? "");
        if ("description" in patch) setDescription(saved.description ?? "");
        if ("tags" in patch) setTags(saved.tags);
        showWorkspaceToast({
          message: error instanceof Error ? error.message : "Could not save.",
          tone: "error",
        });
      })
      .finally(() => {
        pending.current -= 1;
        if (pending.current === 0) setStatus("saved");
      });
  }

  function commitName() {
    const next = name.trim();
    if (!next) {
      setName(server.current.displayName);
      return;
    }
    if (next !== server.current.displayName) save({ displayName: next });
  }

  function addTags(value: string) {
    const added = value.split(/\s+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
    setTagDraft("");
    const next = [...tags, ...added.filter((tag) => !tags.includes(tag))];
    if (next.length === tags.length) return;
    setTags(next);
    save({ tags: next });
  }

  function removeTag(tag: string) {
    const next = tags.filter((candidate) => candidate !== tag);
    setTags(next);
    save({ tags: next });
  }

  const sharing = describeSharing(linked, asset.visibility === "public");
  const dimensions = asset.width && asset.height ? `${asset.width} × ${asset.height}` : null;

  return (
    <div className="grid gap-4 p-4">
      <button
        type="button"
        onClick={onView}
        aria-label={`View ${asset.displayName}`}
        className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <AssetPreview asset={asset} />
      </button>

      <div className="flex items-start gap-1">
        <Input
          value={name}
          aria-label="Name"
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.preventDefault();
              setName(server.current.displayName);
              // Blur after the reset lands, so the blur doesn't save the edit.
              const input = event.currentTarget;
              requestAnimationFrame(() => input.blur());
            }
          }}
          className="h-auto min-w-0 flex-1 border-transparent bg-transparent px-1.5 py-1 text-base font-semibold shadow-none hover:border-border/70 focus-visible:border-ring md:text-base"
        />
        <PanelMenu label={`Actions for ${asset.displayName}`}>{menu}</PanelMenu>
      </div>

      <Facts
        rows={[
          ["Type", assetTypeLabel(asset)],
          ["Size", formatBytes(asset.sizeBytes)],
          dimensions ? ["Dimensions", dimensions] : null,
          asset.kind === "video" && asset.durationMs ? ["Length", formatDuration(asset.durationMs)] : null,
          asset.takenAt ? ["Taken", <span key="t" suppressHydrationWarning>{formatDay(asset.takenAt, true)}</span>] : null,
          ["Added", <span key="a" suppressHydrationWarning>{formatDay(asset.createdAt, false)}</span>],
          [
            "Folder",
            <button key="f" type="button" onClick={onOpenFolder} className="inline-flex max-w-full items-center gap-1 truncate text-left hover:underline">
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{folderName ?? "All files"}</span>
            </button>,
          ],
          [
            "Sharing",
            <button key="s" type="button" onClick={onShare} className="text-left hover:underline">
              {sharing}
            </button>,
          ],
        ]}
      />

      <section className="grid gap-2" aria-label="Tags">
        <h3 className="text-xs font-medium text-muted-foreground">Tags</h3>
        {tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag}>
                <span className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="grid size-4 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            addTags(tagDraft);
          }}
        >
          <TagAutocompleteInput
            value={tagDraft}
            onChange={setTagDraft}
            onCommit={addTags}
            placeholder="Add tags…"
            inputClassName="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </form>
      </section>

      <details className="group/fold rounded-md border border-border/60 open:pb-3" open={foldStartsOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open/fold:rotate-90" />
          {asset.kind === "image" ? "Alt text & description" : "Description"}
        </summary>
        <div className="grid gap-3 px-3">
          {asset.kind === "image" ? (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Alt text, read aloud in place of the image</span>
              <Input
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                onBlur={() => {
                  if (alt.trim() !== (server.current.altText ?? "")) save({ altText: alt.trim() });
                }}
                placeholder="What the picture shows"
                className="h-8"
              />
            </label>
          ) : null}
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                if (description.trim() !== (server.current.description ?? "")) {
                  save({ description: description.trim() });
                }
              }}
              rows={3}
              placeholder="Optional"
            />
          </label>
        </div>
      </details>

      <p className="flex h-4 items-center gap-1.5 text-[0.7rem] text-muted-foreground" aria-live="polite">
        {status === "saving" ? (
          <>
            <Loader2 className="size-3 animate-spin" /> Saving…
          </>
        ) : status === "saved" ? (
          "Changes saved"
        ) : (
          "Edits save as you go"
        )}
      </p>
    </div>
  );
}

export function FolderDetails({
  name,
  stats,
  previews,
  location,
  linked,
  createdAt,
  extraRows = [],
  menu,
  hint,
}: {
  name: string;
  stats: { files: number; folders: number; bytes: number };
  previews: string[];
  /** The parent's name, or null for the root and places. */
  location?: string | null;
  /** Has a working share link; undefined where links don't apply. */
  linked?: boolean;
  createdAt?: Date | string;
  extraRows?: [string, ReactNode][];
  menu?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-4 p-4">
      <Mosaic previews={previews} />
      <div className="flex items-start gap-1">
        <h2 className="min-w-0 flex-1 break-words px-1.5 py-1 text-base font-semibold">{name}</h2>
        {menu ? <PanelMenu label={`Actions for ${name}`}>{menu}</PanelMenu> : null}
      </div>
      <Facts
        rows={[
          ["Contains", folderSummary(stats)],
          ["Size", formatBytes(stats.bytes)],
          location !== undefined ? ["Location", location ?? "All files"] : null,
          linked !== undefined ? ["Sharing", linked ? "Anyone with the link" : "Private"] : null,
          createdAt ? ["Created", <span key="c" suppressHydrationWarning>{formatDay(createdAt, false)}</span>] : null,
          ...extraRows,
        ]}
      />
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

export function SelectionDetails({
  assets,
  folderCount,
  menu,
}: {
  assets: AssetLibraryItem[];
  folderCount: number;
  menu: ReactNode;
}) {
  const bytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0);
  const previews = assets.flatMap((asset) => (asset.thumbUrl ? [asset.thumbUrl] : [])).slice(0, 6);

  return (
    <div className="grid gap-4 p-4">
      {previews.length > 0 ? (
        <div className="grid grid-cols-3 gap-1">
          {previews.map((src) => (
            <span key={src} className="block aspect-square overflow-hidden rounded bg-muted">
              <RenditionImage src={src} alt="" className="size-full object-cover" fallback={<span className="block size-full" />} />
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-1">
        <h2 className="min-w-0 flex-1 px-1.5 py-1 text-base font-semibold">
          {assets.length + folderCount} items selected
        </h2>
        <PanelMenu label="Actions for the selection">{menu}</PanelMenu>
      </div>
      <Facts
        rows={[
          folderCount > 0 ? ["Folders", String(folderCount)] : null,
          assets.length > 0 ? ["Files", String(assets.length)] : null,
          assets.length > 0 ? ["Size", formatBytes(bytes)] : null,
        ]}
      />
      <Hint>Right-click the selection, or use “⋯”, to move or bin it.</Hint>
    </div>
  );
}

function Mosaic({ previews }: { previews: string[] }) {
  if (previews.length === 0) {
    return (
      <div className="grid h-32 place-items-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground/70">
        <Folder className="size-10 stroke-[1.25]" />
      </div>
    );
  }
  const shown = previews.length >= 4 ? previews.slice(0, 4) : previews.slice(0, 1);
  return (
    <div className={cn("grid h-40 gap-px overflow-hidden rounded-md border border-border/60 bg-border/40", shown.length === 4 && "grid-cols-2 grid-rows-2")}>
      {shown.map((src) => (
        <RenditionImage key={src} src={src} alt="" className="size-full object-cover" fallback={<span className="block size-full bg-muted" />} />
      ))}
    </div>
  );
}

function Facts({ rows }: { rows: ([string, ReactNode] | null)[] }) {
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-1.5 text-sm">
      {rows.flatMap((row) =>
        row
          ? [
              <dt key={`${row[0]}-t`} className="text-xs leading-5 text-muted-foreground">
                {row[0]}
              </dt>,
              <dd key={`${row[0]}-d`} className="min-w-0 truncate leading-5">
                {row[1]}
              </dd>,
            ]
          : [],
      )}
    </dl>
  );
}

function PanelMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:bg-muted"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 px-1.5 text-xs leading-relaxed text-muted-foreground">
      <MousePointerClick className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function describeSharing(linked: boolean, listed: boolean) {
  if (linked && listed) return "Link · Public gallery";
  if (linked) return "Anyone with the link";
  if (listed) return "Public gallery";
  return "Private";
}

function sameTags(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
