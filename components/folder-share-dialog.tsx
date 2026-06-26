"use client";

import { useEffect, useState, useTransition } from "react";
import { FolderOpen, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserSearchField } from "@/components/user-search-field";
import {
  getFolderShareData,
  removeFolderCollaboratorAction,
  shareFolderAction,
  updateFolderCollaboratorRoleAction,
} from "@/server/folders";

type FolderShareData = NonNullable<
  Awaited<ReturnType<typeof getFolderShareData>>
>;

export function FolderShareDialog({
  folder,
  onClose,
}: {
  folder: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<FolderShareData | null>(null);
  const [isPending, startTransition] = useTransition();
  const open = folder !== null;
  const isLoaded = Boolean(folder && data && data.folderId === folder.id);

  useEffect(() => {
    if (!folder) {
      return;
    }

    let cancelled = false;
    void getFolderShareData(folder.id).then((next) => {
      if (!cancelled) {
        setData(next ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [folder]);

  function mutate(action: (fd: FormData) => Promise<unknown>, fd: FormData) {
    startTransition(async () => {
      await action(fd);
      if (folder) {
        const next = await getFolderShareData(folder.id);
        setData(next ?? null);
      }
    });
  }

  const priorityUsers = (data?.friends ?? []).map((friend) => ({
    id: friend.id,
    nickname: friend.name,
    username: friend.username ?? null,
    email: friend.email,
    image: friend.image ?? null,
    priorityLabel: "Friend",
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[min(88dvh,42rem)] overflow-hidden rounded-lg border border-border/70 bg-background/95 p-0 shadow-2xl sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            Share folder
          </DialogTitle>
          <DialogDescription>
            Everyone you invite can open every document in{" "}
            <span className="font-medium text-foreground">
              {folder?.name}
            </span>{" "}
            and its subfolders.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(min(88dvh,42rem)-5.8rem)] overflow-y-auto px-5 py-5">
          <section>
            <h3 className="text-sm font-semibold">Invite people</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Friends appear first, then other matching Vault users.
            </p>
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                const fd = new FormData(event.currentTarget);
                if (folder) {
                  fd.set("folderId", folder.id);
                  mutate(shareFolderAction, fd);
                  event.currentTarget.reset();
                }
              }}
            >
              <UserSearchField
                placeholder="Nickname, username, or email"
                priorityUsers={priorityUsers}
                required
              />
              <select
                name="role"
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                defaultValue="viewer"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <Button type="submit" disabled={isPending}>
                Invite
              </Button>
            </form>
          </section>

          <section className="mt-6 border-t border-border/60 pt-5">
            <h3 className="text-sm font-semibold">People with access</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Folder shares apply to everything inside this folder.
            </p>

            <div className="mt-3 divide-y divide-border/60 rounded-md border border-border/60">
              {!isLoaded ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : data && data.collaborators.length > 0 ? (
                data.collaborators.map((collaborator) => (
                  <div
                    key={collaborator.userId}
                    className="grid items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_2rem]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {collaborator.name ??
                          collaborator.email ??
                          "Unnamed user"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {collaborator.email}
                      </p>
                    </div>

                    <select
                      className="h-8 w-full rounded-md border border-border/70 bg-background/70 px-2 text-xs"
                      defaultValue={collaborator.role}
                      disabled={isPending}
                      onChange={(event) => {
                        if (!folder) {
                          return;
                        }
                        const fd = new FormData();
                        fd.set("folderId", folder.id);
                        fd.set("userId", collaborator.userId);
                        fd.set("role", event.currentTarget.value);
                        mutate(updateFolderCollaboratorRoleAction, fd);
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove access"
                      title="Remove access"
                      disabled={isPending}
                      onClick={() => {
                        if (!folder) {
                          return;
                        }
                        const fd = new FormData();
                        fd.set("folderId", folder.id);
                        fd.set("userId", collaborator.userId);
                        mutate(removeFolderCollaboratorAction, fd);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  No one has folder access yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
