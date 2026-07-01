"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderShareDialog } from "@/components/folder-share-dialog";
import {
  createDocumentInFolderAction,
  restoreArchivedDocumentAction,
} from "@/server/documents";
import {
  createFolderAction,
  deleteFolderAction,
  moveDocumentToFolderAction,
  moveFolderAction,
  renameFolderAction,
} from "@/server/folders";
import { cn } from "@/lib/utils";
import type {
  WorkspaceArchivedItem,
  WorkspaceDocumentItem,
  WorkspaceFolderItem,
  WorkspaceSharedFolderItem,
} from "@/components/workspace/workspace-types";

type WorkspaceFileBrowserProps = {
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  published: WorkspaceDocumentItem[];
  archived: WorkspaceArchivedItem[];
  binRetentionDays: number | null;
  folders: WorkspaceFolderItem[];
  sharedFolders: WorkspaceSharedFolderItem[];
  activeHref?: string;
};

const expandedFoldersKey = "vault.workspace.expandedFolders.v1";
const ROOT = "__root__";

type DragPayload =
  | { kind: "doc"; id: string }
  | { kind: "folder"; id: string };

export function WorkspaceFileBrowser({
  owned,
  shared,
  published,
  archived,
  binRetentionDays,
  folders,
  sharedFolders,
  activeHref,
}: WorkspaceFileBrowserProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceFolderItem | null>(
    null,
  );
  const [sharingFolder, setSharingFolder] = useState<WorkspaceFolderItem | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Defer the localStorage read past hydration so the server/client markup
    // matches, mirroring VaultWorkspaceShell.
    const frame = window.requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(expandedFoldersKey);
        if (raw) {
          setExpanded(new Set(JSON.parse(raw) as string[]));
        }
      } catch {
        // ignore malformed storage
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const folderIds = useMemo(
    () => new Set(folders.map((folder) => folder.id)),
    [folders],
  );

  const childFolders = useMemo(() => {
    const map = new Map<string, WorkspaceFolderItem[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? ROOT;
      map.set(key, [...(map.get(key) ?? []), folder]);
    }
    return map;
  }, [folders]);

  const sharedFolderIds = useMemo(
    () => new Set(sharedFolders.map((folder) => folder.id)),
    [sharedFolders],
  );

  const docsByFolder = useMemo(() => {
    const map = new Map<string, WorkspaceDocumentItem[]>();
    for (const doc of owned) {
      if (doc.folderId && folderIds.has(doc.folderId)) {
        // Filed in one of the user's own folders.
        map.set(doc.folderId, [...(map.get(doc.folderId) ?? []), doc]);
      } else if (doc.folderId && sharedFolderIds.has(doc.folderId)) {
        // The user created/moved this into a folder shared with them; it is
        // rendered inside that folder in the "Shared with me" tree instead.
        continue;
      } else {
        // No folder, or a folder that is no longer visible: show at the root so
        // it is never hidden from its owner.
        map.set(ROOT, [...(map.get(ROOT) ?? []), doc]);
      }
    }
    return map;
  }, [owned, folderIds, sharedFolderIds]);

  function persistExpanded(next: Set<string>) {
    setExpanded(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        expandedFoldersKey,
        JSON.stringify([...next]),
      );
    }
  }

  function toggleFolder(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    persistExpanded(next);
  }

  function expandFolder(id: string) {
    if (!expanded.has(id)) {
      const next = new Set(expanded);
      next.add(id);
      persistExpanded(next);
    }
  }

  function runAction(build: () => FormData, action: (fd: FormData) => unknown) {
    startTransition(() => {
      void action(build());
    });
  }

  function moveDoc(documentId: string, folderId: string | null) {
    runAction(() => {
      const fd = new FormData();
      fd.set("documentId", documentId);
      fd.set("folderId", folderId ?? "");
      return fd;
    }, moveDocumentToFolderAction);
  }

  function moveFolder(folderId: string, parentId: string | null) {
    runAction(() => {
      const fd = new FormData();
      fd.set("folderId", folderId);
      fd.set("parentId", parentId ?? "");
      return fd;
    }, moveFolderAction);
  }

  function createFolder(name: string, parentId: string | null) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (parentId) {
      expandFolder(parentId);
    }
    runAction(() => {
      const fd = new FormData();
      fd.set("name", trimmed);
      fd.set("parentId", parentId ?? "");
      return fd;
    }, createFolderAction);
  }

  function renameFolder(folderId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    runAction(() => {
      const fd = new FormData();
      fd.set("folderId", folderId);
      fd.set("name", trimmed);
      return fd;
    }, renameFolderAction);
  }

  function deleteFolder(folderId: string) {
    runAction(() => {
      const fd = new FormData();
      fd.set("folderId", folderId);
      return fd;
    }, deleteFolderAction);
  }

  function newDocInFolder(folderId: string | null) {
    runAction(() => {
      const fd = new FormData();
      fd.set("folderId", folderId ?? "");
      return fd;
    }, createDocumentInFolderAction);
  }

  function handleDropOn(target: string | null, payload: DragPayload) {
    if (payload.kind === "doc") {
      moveDoc(payload.id, target);
      return;
    }

    // Folders cannot be dropped into themselves; deeper cycle checks happen on
    // the server.
    if (payload.id !== target) {
      moveFolder(payload.id, target);
    }
  }

  const rootFolders = childFolders.get(ROOT) ?? [];
  const rootDocs = docsByFolder.get(ROOT) ?? [];

  return (
    <div className={cn("flex h-full min-h-0 flex-col", isPending && "opacity-90")}>
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Vault
          </p>
          <h2 className="text-sm font-semibold">Files</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="New folder"
            onClick={() => setCreatingIn(ROOT)}
          >
            <FolderPlus className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="New document"
            onClick={() => newDocInFolder(null)}
          >
            <FilePlus2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* The whole Folders section is a drop zone for the root level; nested
            folder zones stop propagation so the deepest folder under the cursor
            wins (VS Code-style). */}
        <section
          onDragOver={(event) => {
            if (hasDragPayload(event)) {
              event.preventDefault();
              setDropTarget(ROOT);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropTarget(null);
            const payload = readDragPayload(event);
            if (payload) {
              handleDropOn(null, payload);
            }
          }}
          className={cn(
            "mb-3 rounded-md",
            dropTarget === ROOT && "bg-primary/10 ring-1 ring-primary/30",
          )}
        >
          <div className="flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span>Folders</span>
          </div>

          {creatingIn === ROOT ? (
            <InlineFolderInput
              depth={0}
              placeholder="Folder name"
              onCommit={(name) => {
                createFolder(name, null);
                setCreatingIn(null);
              }}
              onCancel={() => setCreatingIn(null)}
            />
          ) : null}

          {rootFolders.length === 0 &&
          rootDocs.length === 0 &&
          creatingIn !== ROOT ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/70">
              No folders yet. Create one to organize your documents.
            </p>
          ) : null}

          <div className="grid gap-0.5">
            {rootFolders.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                depth={0}
                expanded={expanded}
                childFolders={childFolders}
                docsByFolder={docsByFolder}
                activeHref={activeHref}
                creatingIn={creatingIn}
                renamingId={renamingId}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
                onToggle={toggleFolder}
                onStartCreate={setCreatingIn}
                onStartRename={setRenamingId}
                onCancelCreate={() => setCreatingIn(null)}
                onCancelRename={() => setRenamingId(null)}
                onCreateFolder={createFolder}
                onRenameFolder={(id, name) => {
                  renameFolder(id, name);
                  setRenamingId(null);
                }}
                onRequestDelete={setPendingDelete}
                onRequestShare={setSharingFolder}
                onNewDoc={newDocInFolder}
                onExpand={expandFolder}
                onDropOn={handleDropOn}
              />
            ))}

            {rootDocs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                depth={0}
                activeHref={activeHref}
                onDragEndClear={() => setDropTarget(null)}
              />
            ))}
          </div>
        </section>

        <SharedSection
          items={shared}
          ownedDocs={owned}
          sharedFolders={sharedFolders}
          expanded={expanded}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onToggle={toggleFolder}
          onNewDoc={newDocInFolder}
          onDropOn={handleDropOn}
          activeHref={activeHref}
        />
        <FlatSection
          title="Published"
          items={published}
          icon={Globe2}
          activeHref={activeHref}
          emptyText="No published documents"
        />
        <BinSection items={archived} retentionDays={binRetentionDays} />
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete folder</DialogTitle>
            <DialogDescription>
              Delete{" "}
              <span className="font-medium text-foreground">
                {pendingDelete?.name}
              </span>
              ? Subfolders are removed too. Documents inside are moved out of the
              folder, not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pendingDelete) {
                  deleteFolder(pendingDelete.id);
                }
                setPendingDelete(null);
              }}
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderShareDialog
        folder={sharingFolder}
        onClose={() => setSharingFolder(null)}
      />
    </div>
  );
}

function FolderNode({
  folder,
  depth,
  expanded,
  childFolders,
  docsByFolder,
  activeHref,
  creatingIn,
  renamingId,
  dropTarget,
  setDropTarget,
  onToggle,
  onStartCreate,
  onStartRename,
  onCancelCreate,
  onCancelRename,
  onCreateFolder,
  onRenameFolder,
  onRequestDelete,
  onRequestShare,
  onNewDoc,
  onExpand,
  onDropOn,
}: {
  folder: WorkspaceFolderItem;
  depth: number;
  expanded: Set<string>;
  childFolders: Map<string, WorkspaceFolderItem[]>;
  docsByFolder: Map<string, WorkspaceDocumentItem[]>;
  activeHref?: string;
  creatingIn: string | null;
  renamingId: string | null;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onToggle: (id: string) => void;
  onStartCreate: (id: string) => void;
  onStartRename: (id: string) => void;
  onCancelCreate: () => void;
  onCancelRename: () => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRequestDelete: (folder: WorkspaceFolderItem) => void;
  onRequestShare: (folder: WorkspaceFolderItem) => void;
  onNewDoc: (folderId: string | null) => void;
  onExpand: (id: string) => void;
  onDropOn: (target: string | null, payload: DragPayload) => void;
}) {
  const isOpen = expanded.has(folder.id);
  const subFolders = childFolders.get(folder.id) ?? [];
  const docs = docsByFolder.get(folder.id) ?? [];
  const directCount = docs.length;
  const isDropTarget = dropTarget === folder.id;

  return (
    // This wrapper owns the folder row AND its children; dropping anywhere
    // inside it files into this folder. stopPropagation keeps the deepest
    // folder under the cursor as the target.
    <div
      onDragOver={(event) => {
        if (hasDragPayload(event)) {
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(folder.id);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(null);
        const payload = readDragPayload(event);
        if (payload) {
          onDropOn(folder.id, payload);
        }
      }}
      className={cn("rounded-[5px]", isDropTarget && "bg-primary/10 ring-1 ring-primary/30")}
    >
      <div
        draggable
        onDragStart={(event) =>
          writeDragPayload(event, { kind: "folder", id: folder.id })
        }
        onDragEnd={() => setDropTarget(null)}
        style={{ paddingLeft: depth * 12 + 4 }}
        className="group flex min-w-0 items-center gap-1 rounded-[5px] py-1.5 pr-1 text-sm text-foreground/90 transition hover:bg-sidebar-accent"
      >
        <button
          type="button"
          onClick={() => onToggle(folder.id)}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          aria-label={isOpen ? "Collapse folder" : "Expand folder"}
        >
          <ChevronRight
            className={cn("size-3.5 transition", isOpen && "rotate-90")}
          />
        </button>

        {renamingId === folder.id ? (
          <InlineFolderInput
            depth={0}
            defaultValue={folder.name}
            placeholder="Folder name"
            inline
            onCommit={(name) => onRenameFolder(folder.id, name)}
            onCancel={onCancelRename}
          />
        ) : (
          <button
            type="button"
            onClick={() => onToggle(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {directCount > 0 && !isOpen ? (
              <span className="shrink-0 text-[0.65rem] text-muted-foreground/70">
                {directCount}
              </span>
            ) : null}
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted/70 hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
            aria-label="Folder actions"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onNewDoc(folder.id)}>
              <FilePlus2 className="size-4" />
              New document
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onExpand(folder.id);
                onStartCreate(folder.id);
              }}
            >
              <FolderPlus className="size-4" />
              New subfolder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStartRename(folder.id)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRequestShare(folder)}>
              <Users className="size-4" />
              Share folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onRequestDelete(folder)}
            >
              <Trash2 className="size-4" />
              Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isOpen ? (
        <div>
          {creatingIn === folder.id ? (
            <InlineFolderInput
              depth={depth + 1}
              placeholder="Folder name"
              onCommit={(name) => {
                onCreateFolder(name, folder.id);
                onCancelCreate();
              }}
              onCancel={onCancelCreate}
            />
          ) : null}

          {subFolders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              childFolders={childFolders}
              docsByFolder={docsByFolder}
              activeHref={activeHref}
              creatingIn={creatingIn}
              renamingId={renamingId}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onToggle={onToggle}
              onStartCreate={onStartCreate}
              onStartRename={onStartRename}
              onCancelCreate={onCancelCreate}
              onCancelRename={onCancelRename}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onRequestDelete={onRequestDelete}
              onRequestShare={onRequestShare}
              onNewDoc={onNewDoc}
              onExpand={onExpand}
              onDropOn={onDropOn}
            />
          ))}

          {docs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              depth={depth + 1}
              activeHref={activeHref}
              onDragEndClear={() => setDropTarget(null)}
            />
          ))}

          {subFolders.length === 0 &&
          docs.length === 0 &&
          creatingIn !== folder.id ? (
            <p
              className="py-1 text-xs text-muted-foreground/60"
              style={{ paddingLeft: (depth + 1) * 12 + 24 }}
            >
              Empty
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DocRow({
  doc,
  depth,
  activeHref,
  onDragEndClear,
}: {
  doc: WorkspaceDocumentItem;
  depth: number;
  activeHref?: string;
  onDragEndClear: () => void;
}) {
  return (
    <Link
      href={doc.href}
      draggable
      onDragStart={(event) => writeDragPayload(event, { kind: "doc", id: doc.id })}
      onDragEnd={onDragEndClear}
      style={{ paddingLeft: depth * 12 + 24 }}
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-[5px] py-1.5 pr-2 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        activeHref === doc.href &&
          "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <FileText className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      {doc.visibility === "public" ? (
        <Globe2 className="size-3 shrink-0 opacity-60" />
      ) : null}
    </Link>
  );
}

function InlineFolderInput({
  depth,
  defaultValue = "",
  placeholder,
  inline = false,
  onCommit,
  onCancel,
}: {
  depth: number;
  defaultValue?: string;
  placeholder?: string;
  inline?: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      placeholder={placeholder}
      style={inline ? undefined : { marginLeft: depth * 12 + 24 }}
      className={cn(
        "my-0.5 rounded border border-border bg-background px-1.5 py-1 text-sm outline-none focus:border-primary",
        inline ? "min-w-0 flex-1" : "w-[calc(100%-1.5rem)]",
      )}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const value = event.currentTarget.value;
          if (value.trim()) {
            onCommit(value);
          } else {
            onCancel();
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={(event) => {
        const value = event.currentTarget.value;
        if (value.trim() && value.trim() !== defaultValue) {
          onCommit(value);
        } else {
          onCancel();
        }
      }}
    />
  );
}

function FlatSection({
  title,
  items,
  icon: Icon,
  activeHref,
  emptyText,
}: {
  title: string;
  items: WorkspaceDocumentItem[];
  icon: typeof FileText;
  activeHref?: string;
  emptyText: string;
}) {
  return (
    <section className="mb-3">
      <div className="flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>{title}</span>
        <span>{items.length}</span>
      </div>
      <div className="grid gap-0.5">
        {items.length > 0 ? (
          items.map((item) => (
            <Link
              key={`${title}-${item.id}`}
              href={item.href}
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-[5px] px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                activeHref === item.href &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {item.visibility === "public" ? (
                <Globe2 className="size-3 shrink-0 opacity-60" />
              ) : null}
            </Link>
          ))
        ) : (
          <p className="px-2 py-1 text-xs text-muted-foreground/70">{emptyText}</p>
        )}
      </div>
    </section>
  );
}

function BinSection({
  items,
  retentionDays,
}: {
  items: WorkspaceArchivedItem[];
  retentionDays: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function restore(documentId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("documentId", documentId);
      await restoreArchivedDocumentAction(fd);
      // Re-pull getWorkspaceData so the doc leaves the Bin and returns to Files.
      router.refresh();
    });
  }

  return (
    <section className={cn("mb-3", isPending && "opacity-90")}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition", open && "rotate-90")}
        />
        <Trash2 className="size-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 text-left">Bin</span>
        <span>{items.length}</span>
      </button>

      {open ? (
        <div className="grid gap-0.5">
          {items.length > 0 ? (
            items.map((item) => (
              <div
                key={item.id}
                className="group flex min-w-0 items-center gap-2 rounded-[5px] px-2 py-1.5 pl-6 text-sm text-muted-foreground"
              >
                <FileText className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate" title={item.title}>
                  {item.title}
                </span>
                <span className="shrink-0 text-[0.62rem] text-muted-foreground/70">
                  {formatBinCountdown(item.deletedAt, retentionDays)}
                </span>
                <button
                  type="button"
                  aria-label={`Restore ${item.title}`}
                  title="Restore"
                  disabled={isPending}
                  onClick={() => restore(item.id)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted/70 hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-2 py-1 pl-6 text-xs text-muted-foreground/70">
              Bin is empty
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Short label for how long an archived document remains before auto-deletion. */
function formatBinCountdown(deletedAt: Date, retentionDays: number | null) {
  if (retentionDays === null) {
    return "kept";
  }

  const purgeAt = deletedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000));

  if (daysLeft <= 0) {
    return "deleting soon";
  }

  return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
}

function SharedSection({
  items,
  ownedDocs,
  sharedFolders,
  expanded,
  dropTarget,
  setDropTarget,
  onToggle,
  onNewDoc,
  onDropOn,
  activeHref,
}: {
  items: WorkspaceDocumentItem[];
  ownedDocs: WorkspaceDocumentItem[];
  sharedFolders: WorkspaceSharedFolderItem[];
  expanded: Set<string>;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onToggle: (id: string) => void;
  onNewDoc: (folderId: string | null) => void;
  onDropOn: (target: string | null, payload: DragPayload) => void;
  activeHref?: string;
}) {
  const model = useMemo(() => {
    const sharedFolderIds = new Set(sharedFolders.map((folder) => folder.id));

    // Folders nest under their real parent when that parent is also accessible;
    // otherwise they surface at the top level of their owner's group.
    const childFolders = new Map<string, WorkspaceSharedFolderItem[]>();
    const topFoldersByOwner = new Map<string, WorkspaceSharedFolderItem[]>();
    for (const folder of sharedFolders) {
      if (folder.parentId && sharedFolderIds.has(folder.parentId)) {
        childFolders.set(folder.parentId, [
          ...(childFolders.get(folder.parentId) ?? []),
          folder,
        ]);
      } else {
        topFoldersByOwner.set(folder.ownerId, [
          ...(topFoldersByOwner.get(folder.ownerId) ?? []),
          folder,
        ]);
      }
    }

    // Docs nest under a shared folder when it is visible; otherwise they are
    // loose directly-shared docs shown at the owner's top level. The user's own
    // documents that live inside a shared folder (e.g. created there as an
    // editor) belong in that folder too, not in their own tree.
    const docsByFolder = new Map<string, WorkspaceDocumentItem[]>();
    const looseDocsByOwner = new Map<string, WorkspaceDocumentItem[]>();
    for (const doc of items) {
      if (doc.folderId && sharedFolderIds.has(doc.folderId)) {
        docsByFolder.set(doc.folderId, [
          ...(docsByFolder.get(doc.folderId) ?? []),
          doc,
        ]);
      } else {
        const ownerKey = doc.ownerId ?? "unknown";
        looseDocsByOwner.set(ownerKey, [
          ...(looseDocsByOwner.get(ownerKey) ?? []),
          doc,
        ]);
      }
    }
    for (const doc of ownedDocs) {
      if (doc.folderId && sharedFolderIds.has(doc.folderId)) {
        docsByFolder.set(doc.folderId, [
          ...(docsByFolder.get(doc.folderId) ?? []),
          doc,
        ]);
      }
    }

    const ownerLabels = new Map<string, string>();
    const register = (
      id: string | null | undefined,
      name: string | null | undefined,
      username: string | null | undefined,
    ) => {
      const key = id ?? "unknown";
      if (!ownerLabels.has(key)) {
        ownerLabels.set(
          key,
          name ?? (username ? `@${username}` : "Someone"),
        );
      }
    };
    for (const folder of sharedFolders) {
      register(folder.ownerId, folder.ownerName, folder.ownerUsername);
    }
    for (const doc of items) {
      register(doc.ownerId, doc.ownerName, doc.ownerUsername);
    }

    const ownerKeys = [
      ...new Set([...topFoldersByOwner.keys(), ...looseDocsByOwner.keys()]),
    ].sort((a, b) =>
      (ownerLabels.get(a) ?? "").localeCompare(ownerLabels.get(b) ?? ""),
    );

    return {
      childFolders,
      topFoldersByOwner,
      docsByFolder,
      looseDocsByOwner,
      ownerLabels,
      ownerKeys,
    };
  }, [items, ownedDocs, sharedFolders]);

  // The count reflects everything visible here, including own docs filed into a
  // shared folder.
  const totalCount =
    items.length +
    ownedDocs.filter(
      (doc) =>
        doc.folderId &&
        sharedFolders.some((folder) => folder.id === doc.folderId),
    ).length;

  return (
    <section className="mb-3">
      <div className="flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>Shared with me</span>
        <span>{totalCount}</span>
      </div>

      {model.ownerKeys.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground/70">
          No shared documents
        </p>
      ) : (
        <div className="grid gap-2">
          {model.ownerKeys.map((ownerKey) => (
            <div key={ownerKey}>
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                <Users className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {model.ownerLabels.get(ownerKey)}
                </span>
              </div>
              <div className="grid gap-0.5">
                {(model.topFoldersByOwner.get(ownerKey) ?? []).map((folder) => (
                  <SharedFolderNode
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    expanded={expanded}
                    childFolders={model.childFolders}
                    docsByFolder={model.docsByFolder}
                    dropTarget={dropTarget}
                    setDropTarget={setDropTarget}
                    onToggle={onToggle}
                    onNewDoc={onNewDoc}
                    onDropOn={onDropOn}
                    activeHref={activeHref}
                  />
                ))}
                {(model.looseDocsByOwner.get(ownerKey) ?? []).map((doc) => (
                  <SharedDocRow
                    key={`shared-${doc.id}`}
                    doc={doc}
                    depth={0}
                    activeHref={activeHref}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SharedFolderNode({
  folder,
  depth,
  expanded,
  childFolders,
  docsByFolder,
  dropTarget,
  setDropTarget,
  onToggle,
  onNewDoc,
  onDropOn,
  activeHref,
}: {
  folder: WorkspaceSharedFolderItem;
  depth: number;
  expanded: Set<string>;
  childFolders: Map<string, WorkspaceSharedFolderItem[]>;
  docsByFolder: Map<string, WorkspaceDocumentItem[]>;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onToggle: (id: string) => void;
  onNewDoc: (folderId: string | null) => void;
  onDropOn: (target: string | null, payload: DragPayload) => void;
  activeHref?: string;
}) {
  const isOpen = expanded.has(folder.id);
  const subFolders = childFolders.get(folder.id) ?? [];
  const docs = docsByFolder.get(folder.id) ?? [];
  const editable = folder.role === "editor";
  const isDropTarget = dropTarget === folder.id;

  const node = (
    <div className={cn("rounded-[5px]", isDropTarget && "bg-primary/10 ring-1 ring-primary/30")}>
      <div
        style={{ paddingLeft: depth * 12 + 4 }}
        className="group flex min-w-0 items-center gap-1 rounded-[5px] py-1.5 pr-1 text-sm text-foreground/90 transition hover:bg-sidebar-accent"
      >
        <button
          type="button"
          onClick={() => onToggle(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition",
              isOpen && "rotate-90",
            )}
          />
          {isOpen ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        </button>

        {editable ? (
          <button
            type="button"
            title="New document"
            aria-label="New document in folder"
            onClick={() => onNewDoc(folder.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted/70 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            <FilePlus2 className="size-4" />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div>
          {subFolders.map((child) => (
            <SharedFolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              childFolders={childFolders}
              docsByFolder={docsByFolder}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onToggle={onToggle}
              onNewDoc={onNewDoc}
              onDropOn={onDropOn}
              activeHref={activeHref}
            />
          ))}
          {docs.map((doc) => (
            <SharedDocRow
              key={`shared-${doc.id}`}
              doc={doc}
              depth={depth + 1}
              activeHref={activeHref}
              draggable={editable}
              onDragEndClear={() => setDropTarget(null)}
            />
          ))}
          {subFolders.length === 0 && docs.length === 0 ? (
            <p
              className="py-1 text-xs text-muted-foreground/60"
              style={{ paddingLeft: (depth + 1) * 12 + 24 }}
            >
              Empty
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  // Editor folders accept document drops (add to folder); the deepest editable
  // folder under the cursor wins, mirroring the owned tree.
  if (!editable) {
    return node;
  }

  return (
    <div
      onDragOver={(event) => {
        if (hasDragPayload(event)) {
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(folder.id);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(null);
        const payload = readDragPayload(event);
        if (payload) {
          onDropOn(folder.id, payload);
        }
      }}
    >
      {node}
    </div>
  );
}

function SharedDocRow({
  doc,
  depth,
  activeHref,
  draggable = false,
  onDragEndClear,
}: {
  doc: WorkspaceDocumentItem;
  depth: number;
  activeHref?: string;
  draggable?: boolean;
  onDragEndClear?: () => void;
}) {
  return (
    <Link
      href={doc.href}
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => writeDragPayload(event, { kind: "doc", id: doc.id })
          : undefined
      }
      onDragEnd={draggable ? onDragEndClear : undefined}
      style={{ paddingLeft: depth * 12 + 24 }}
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-[5px] py-1.5 pr-2 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        activeHref === doc.href &&
          "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <FileText className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      {doc.visibility === "public" ? (
        <Globe2 className="size-3 shrink-0 opacity-60" />
      ) : null}
    </Link>
  );
}

function writeDragPayload(event: DragEvent, payload: DragPayload) {
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "move";
}

function hasDragPayload(event: DragEvent) {
  return event.dataTransfer.types.includes("application/json");
}

function readDragPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed.kind === "doc" || parsed.kind === "folder") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
