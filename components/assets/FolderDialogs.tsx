"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChevronRight, Folder, FolderInput, FolderOpen, Library, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  checkFolderMove,
  childFolders,
  descendantFolderIds,
  folderPath,
  normalizeFolderName,
  type FolderNode,
} from "@/lib/asset-folders";
import { cn } from "@/lib/utils";

/** New folder / rename: validates locally, shows the server's refusal inline. */
export function FolderNameDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialName = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  initialName?: string;
  /** Resolve to close; throw to show the error and stay open. */
  onSubmit: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed so each opening starts from `initialName` with no stale error. */}
        {open ? (
          <FolderNameForm
            key={initialName}
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            initialName={initialName}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FolderNameForm({
  title,
  description,
  confirmLabel,
  initialName,
  onCancel,
  onSubmit,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = normalizeFolderName(name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(result.name);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onFocus={(event) => event.currentTarget.select()}
          placeholder="Folder name"
          aria-label="Folder name"
          aria-invalid={error ? true : undefined}
          maxLength={200}
        />
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export type MoveSelection = {
  assets: { id: string; folderId: string | null }[];
  folderIds: string[];
};

/**
 * "Move to…": the folder tree with the library root on top. Destinations the
 * server would refuse (into itself or below, too deep, a name clash) are
 * disabled with the reason, using the same rules the server runs.
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  selection,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderNode[];
  selection: MoveSelection;
  onMove: (targetFolderId: string | null, targetName: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <MoveToFolderForm
            folders={folders}
            selection={selection}
            onCancel={() => onOpenChange(false)}
            onMove={onMove}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveToFolderForm({
  folders,
  selection,
  onCancel,
  onMove,
}: {
  folders: FolderNode[];
  selection: MoveSelection;
  onCancel: () => void;
  onMove: (targetFolderId: string | null, targetName: string) => Promise<void>;
}) {
  // Start where the first item lives, with its ancestors expanded.
  const startId =
    selection.assets[0]?.folderId ??
    folders.find((folder) => folder.id === selection.folderIds[0])?.parentId ??
    null;
  const [target, setTarget] = useState<string | null>(startId);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(folderPath(folders, startId).map((folder) => folder.id)),
  );
  const [moving, setMoving] = useState(false);
  const count = selection.assets.length + selection.folderIds.length;

  // Folders being moved (and what's inside them) can't be destinations.
  const blocked = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selection.folderIds) {
      ids.add(id);
      for (const descendant of descendantFolderIds(folders, id)) ids.add(descendant);
    }
    return ids;
  }, [folders, selection.folderIds]);

  const refusal = useMemo(() => {
    for (const folderId of selection.folderIds) {
      const check = checkFolderMove(folders, folderId, target);
      if (!check.ok && check.reason !== "same-place") {
        const name = folders.find((folder) => folder.id === folderId)?.name ?? "A folder";
        return check.reason === "name-taken"
          ? `“${name}” already exists there.`
          : check.reason === "too-deep"
            ? "That would nest folders too deep."
            : "A folder can't go inside itself.";
      }
    }
    const allThere =
      selection.assets.every((asset) => asset.folderId === target) &&
      selection.folderIds.every(
        (id) => folders.find((folder) => folder.id === id)?.parentId === target,
      );
    return allThere ? "Already here." : null;
  }, [folders, selection, target]);

  const targetName =
    target === null ? "All files" : (folders.find((folder) => folder.id === target)?.name ?? "folder");

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderLevel(parentId: string | null, depth: number) {
    return childFolders(folders, parentId).map((folder) => {
      const children = childFolders(folders, folder.id).length > 0;
      const open = expanded.has(folder.id);
      const disabled = blocked.has(folder.id);
      const selected = target === folder.id;

      return (
        <li key={folder.id}>
          <div
            className={cn(
              "flex items-center gap-1 rounded-md pr-2 text-sm",
              selected ? "bg-primary/12 text-foreground" : "hover:bg-muted/60",
              disabled && "opacity-45",
            )}

          >
            <span aria-hidden className="shrink-0">
              {/* Indentation via repeated spacers keeps this free of inline styles. */}
              {Array.from({ length: depth }, (_, index) => (
                <span key={index} className="inline-block w-4" />
              ))}
            </span>
            <button
              type="button"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              disabled={!children}
              onClick={() => toggle(folder.id)}
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground disabled:invisible"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => setTarget(folder.id)}
              onDoubleClick={() => toggle(folder.id)}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left disabled:cursor-not-allowed"
            >
              {selected ? (
                <FolderOpen className="size-4 shrink-0 text-primary" />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{folder.name}</span>
            </button>
          </div>
          {open && children ? <ul>{renderLevel(folder.id, depth + 1)}</ul> : null}
        </li>
      );
    });
  }

  async function confirm() {
    setMoving(true);
    try {
      await onMove(target, targetName);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Move {count === 1 ? "1 item" : `${count} items`}</DialogTitle>
        <DialogDescription>Choose where it goes.</DialogDescription>
      </DialogHeader>
      <div className="max-h-80 overflow-y-auto rounded-md border border-border/70 p-1">
        <button
          type="button"
          aria-pressed={target === null}
          onClick={() => setTarget(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium",
            target === null ? "bg-primary/12" : "hover:bg-muted/60",
          )}
        >
          <Library className="size-4 text-muted-foreground" />
          All files
        </button>
        <ul>{renderLevel(null, 0)}</ul>
        {folders.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No folders yet.</p>
        ) : null}
      </div>
      <DialogFooter className="sm:justify-between">
        <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
          {refusal ?? `Into ${targetName}`}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={refusal !== null || moving} onClick={() => void confirm()}>
            {moving ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <FolderInput data-icon="inline-start" />
            )}
            Move here
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
