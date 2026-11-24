"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ImageIcon, Shuffle, Smile } from "lucide-react";

import { cn } from "@/lib/utils";

/** A small set to pick from; anything else can be typed or pasted. */
const EMOJI = [
  "📝", "📓", "📔", "📚", "📌", "📎", "🗂️", "🗒️", "✅", "☑️", "📅", "🗓️",
  "💡", "🧠", "🎯", "🚀", "⭐", "🔥", "✨", "🌱", "🌿", "🌸", "🌊", "⛰️",
  "🏠", "🏡", "✈️", "🧳", "🗺️", "🏝️", "🍳", "☕", "🍰", "🎵", "🎮", "🎨",
  "📷", "🎬", "📺", "💻", "🛠️", "⚙️", "🔧", "🧪", "🔬", "📈", "💰", "🧾",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🐱", "🐶", "🦊", "🐢", "🦉", "🐝",
  "🙂", "😎", "🤔", "🥳", "😴", "💬", "📣", "🔒", "🔑", "⚠️", "❓", "🏆",
];

export type PageArtEditing = {
  onSetIcon: (icon: string | null) => void;
  /** Opens the asset picker; the cover changes when an image is chosen. */
  onPickCover: () => void;
  onRemoveCover: () => void;
};

/**
 * A page's cover image and icon above its title (frontmatter `cover:` and
 * `icon:`). Editors see "Add icon" / "Add cover" when they hover the top of
 * the page, so an empty page stays clean.
 */
export function DocumentPageArt({
  documentId,
  icon,
  coverAssetId,
  editing,
}: {
  documentId: string;
  icon: string | null;
  coverAssetId: string | null;
  editing?: PageArtEditing | null;
}) {
  if (!editing && !icon && !coverAssetId) return null;

  return (
    <div className="group/page-art grid gap-2">
      {coverAssetId ? (
        <div className="relative h-36 overflow-hidden rounded-xl bg-muted sm:h-48">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/assets/${coverAssetId}/content?doc=${documentId}&r=display`}
            alt=""
            className="size-full object-cover"
            onError={(event) => {
              // A cover the reader can't see (private, binned) just isn't shown.
              event.currentTarget.parentElement?.setAttribute("hidden", "");
            }}
          />
          {editing ? (
            <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition group-hover/page-art:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <ArtButton onClick={editing.onPickCover}>Change cover</ArtButton>
              <ArtButton onClick={editing.onRemoveCover}>Remove</ArtButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {icon ? (
        editing ? (
          <IconPicker icon={icon} onSetIcon={editing.onSetIcon}>
            <span className="text-5xl leading-none sm:text-6xl">{icon}</span>
          </IconPicker>
        ) : (
          <span className="text-5xl leading-none sm:text-6xl" aria-hidden="true">
            {icon}
          </span>
        )
      ) : null}

      {editing && (!icon || !coverAssetId) ? (
        <div className="flex h-7 items-center gap-1 text-xs text-muted-foreground opacity-0 transition group-hover/page-art:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {!icon ? (
            <IconPicker icon={null} onSetIcon={editing.onSetIcon}>
              <span className="inline-flex items-center gap-1.5">
                <Smile className="size-3.5" /> Add icon
              </span>
            </IconPicker>
          ) : null}
          {!coverAssetId ? (
            <button
              type="button"
              onClick={editing.onPickCover}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ImageIcon className="size-3.5" /> Add cover
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ArtButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-background/85 px-2 py-1 text-xs text-foreground shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {children}
    </button>
  );
}

function IconPicker({
  icon,
  onSetIcon,
  children,
}: {
  icon: string | null;
  onSetIcon: (icon: string | null) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const choose = (next: string | null) => {
    onSetIcon(next);
    setOpen(false);
    setTyped("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "w-fit rounded-md transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          icon ? "p-1" : "px-2 py-1 hover:text-foreground",
        )}
        aria-label={icon ? "Change icon" : "Add icon"}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup className="grid w-72 gap-2 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
            <div className="flex items-center gap-1">
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && typed.trim()) {
                    event.preventDefault();
                    choose(Array.from(typed.trim()).slice(0, 4).join(""));
                  }
                }}
                placeholder="Type or paste an emoji"
                aria-label="Icon"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              />
              <button
                type="button"
                title="Random"
                aria-label="Random icon"
                onClick={() => choose(EMOJI[Math.floor(Math.random() * EMOJI.length)])}
                className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Shuffle className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => choose(emoji)}
                  className={cn(
                    "grid size-8 place-items-center rounded-md text-lg transition hover:bg-muted",
                    emoji === icon && "bg-muted",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {icon ? (
              <button
                type="button"
                onClick={() => choose(null)}
                className="rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Remove icon
              </button>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
