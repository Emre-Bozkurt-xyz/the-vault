"use client";

import { useEffect, useState } from "react";
import { Copy, Globe2, Link2, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dispatchAssetsChanged } from "@/lib/asset-events";
import { showWorkspaceToast } from "@/lib/workspace-toast";
import { cn } from "@/lib/utils";

export type ShareTarget = {
  kind: "folder" | "asset";
  id: string;
  name: string;
  /** Files only: listed in the owner's public gallery. */
  listed?: boolean;
  /** Files only: lists or unlists it; throws with the server's message. */
  onListedChange?: (listed: boolean) => Promise<void>;
};

type ShareLink = {
  id: string;
  path: string;
  allowDownload: boolean;
  expiresAt: string | null;
  expired: boolean;
  lastViewedAt: string | null;
};

const EXPIRY_OPTIONS: [string, string][] = [
  ["never", "Never expires"],
  ["1", "Expires in 1 day"],
  ["7", "Expires in 7 days"],
  ["30", "Expires in 30 days"],
];

/**
 * "Share…" for a media folder or file: anyone with the link can view it on a
 * stripped-down page, no account needed. On/off, copy, allow downloads,
 * expiry, and "new link" (the old one stops working). Settings save as they
 * change; the URL stays the same unless reset.
 */
export function ShareLinkDialog({
  target,
  onOpenChange,
}: {
  target: ShareTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {target ? <ShareLinkForm key={`${target.kind}:${target.id}`} target={target} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareLinkForm({ target }: { target: ShareTarget }) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = `${target.kind === "folder" ? "folderId" : "assetId"}=${target.id}`;
  const url = link ? `${window.location.origin}${link.path}` : "";

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/assets/share-links?${query}`)
      .then((response) => response.json())
      .then((payload: { link?: ShareLink | null }) => {
        if (!cancelled) setLink(payload.link ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the link.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function call(path: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        ...init,
        headers: init.body ? { "Content-Type": "application/json" } : undefined,
      });
      const payload = (await response.json().catch(() => null)) as { link?: ShareLink; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Something went wrong.");
      dispatchAssetsChanged();
      return payload;
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(settings: { allowDownload: boolean; expiresInDays: number | null }) {
    const payload = await call("/api/assets/share-links", {
      method: "POST",
      body: JSON.stringify({ [target.kind === "folder" ? "folderId" : "assetId"]: target.id, ...settings }),
    });
    if (payload?.link) setLink(payload.link);
    return payload?.link ?? null;
  }

  async function turnOn() {
    const created = await save({ allowDownload: true, expiresInDays: null });
    if (created) await copy(`${window.location.origin}${created.path}`);
  }

  async function turnOff() {
    if (!link) return;
    if (await call(`/api/assets/share-links/${link.id}`, { method: "DELETE" })) {
      setLink(null);
      showWorkspaceToast({ message: "Link turned off. It no longer works.", durationMs: 3000 });
    }
  }

  async function reset() {
    if (!link) return;
    const payload = await call(`/api/assets/share-links/${link.id}/reset`, { method: "POST" });
    if (payload?.link) {
      setLink(payload.link);
      await copy(`${window.location.origin}${payload.link.path}`);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showWorkspaceToast({ message: "Link copied.", durationMs: 1800 });
    } catch {
      showWorkspaceToast({ message: "Could not copy the link.", tone: "error" });
    }
  }

  const expiryValue = !link?.expiresAt ? "never" : "custom";
  const what = target.kind === "folder" ? "this folder and everything in it" : "this file";

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="break-words">Share “{target.name}”</DialogTitle>
        <DialogDescription>
          Anyone with the link can view {what}, without an account. Things you add
          {target.kind === "folder" ? " to the folder later appear too; binning it pauses the link." : " stay private elsewhere."}
        </DialogDescription>
      </DialogHeader>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : link ? (
        <>
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" onClick={() => void copy(url)} disabled={busy}>
              <Copy data-icon="inline-start" />
              Copy
            </Button>
          </div>
          {link.expired ? (
            <p className="text-xs text-destructive">This link has expired. Choose a new expiry to turn it back on.</p>
          ) : null}
          <label className="flex items-start gap-3 rounded-md border border-border/70 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-foreground"
              checked={link.allowDownload}
              // On an expired link, saving would set a new expiry and quietly
              // revive it; reviving is an explicit expiry choice below.
              disabled={busy || link.expired}
              onChange={(event) => {
                // Show the change at once; put it back if the save fails.
                const allowDownload = event.target.checked;
                const previous = link;
                setLink({ ...link, allowDownload });
                void save({ allowDownload, expiresInDays: remainingDays(link.expiresAt) }).then(
                  (saved) => {
                    if (!saved) setLink(previous);
                  },
                );
              }}
            />
            <span className="text-sm">
              <span className="block font-medium">Allow downloads</span>
              <span className="block text-xs text-muted-foreground">
                Originals and “Download all”. Off shows display-size copies only (no
                camera location data); videos still play.
              </span>
            </span>
          </label>
          <select
            aria-label="Link expiry"
            value={expiryValue === "custom" ? "keep" : "never"}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "keep") return;
              void save({
                allowDownload: link.allowDownload,
                expiresInDays: value === "never" ? null : Number(value),
              });
            }}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
          >
            {link.expiresAt ? (
              <option value="keep">
                {link.expired ? "Expired" : "Expires"} {new Date(link.expiresAt).toLocaleDateString()}
              </option>
            ) : null}
            {EXPIRY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <p className="text-xs text-muted-foreground">
              {link.lastViewedAt ? `Last opened ${new Date(link.lastViewedAt).toLocaleDateString()}` : "Not opened yet"}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => void reset()} disabled={busy} title="Make a new link; the current one stops working">
                <RefreshCw data-icon="inline-start" />
                New link
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void turnOff()} disabled={busy}>
                Turn off
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="grid justify-items-start gap-3 rounded-md border border-dashed border-border/80 p-4">
          <p className="text-sm text-muted-foreground">Link sharing is off. Only you can see {what}.</p>
          <Button type="button" onClick={() => void turnOn()} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Link2 data-icon="inline-start" />}
            Create link
          </Button>
        </div>
      )}
      {error ? (
        <p className={cn("text-xs text-destructive")} role="alert">
          {error}
        </p>
      ) : null}

      {target.kind === "asset" && target.onListedChange ? (
        <GalleryListing listed={target.listed ?? false} onChange={target.onListedChange} />
      ) : null}
    </div>
  );
}

/**
 * The other way a file is seen outside Vault: listed in the owner's public
 * gallery (and readable by anyone with its plain link), independent of the
 * share link above.
 */
function GalleryListing({
  listed: initialListed,
  onChange,
}: {
  listed: boolean;
  onChange: (listed: boolean) => Promise<void>;
}) {
  const [listed, setListed] = useState(initialListed);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    // Show the change at once; put it back if the save fails.
    setListed(next);
    setSaving(true);
    try {
      await onChange(next);
      showWorkspaceToast({
        message: next ? "Listed in your public gallery." : "Removed from your public gallery.",
        durationMs: 2500,
      });
    } catch (error) {
      setListed(!next);
      showWorkspaceToast({
        message: error instanceof Error ? error.message : "Could not change the gallery listing.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-start gap-3 border-t border-border/60 pt-4">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-foreground"
        checked={listed}
        disabled={saving}
        onChange={(event) => void toggle(event.target.checked)}
      />
      <span className="text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Globe2 className="size-3.5 text-muted-foreground" /> Show in public gallery
        </span>
        <span className="block text-xs text-muted-foreground">
          Listed in the gallery, and anyone with its file link can open it. Off keeps it to you
          and the readers of documents that embed it.
        </span>
      </span>
    </label>
  );
}

/** Days left on an expiry, rounded up, so saving another setting keeps it. */
function remainingDays(expiresAt: string | null) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return Math.min(365, Math.max(1, days));
}
