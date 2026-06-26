"use client";

import { useEffect, useState } from "react";
import { Folder, Share2, Trash2 } from "lucide-react";

import {
  consumePendingDocumentCommand,
  subscribeToDocumentCommand,
} from "@/lib/document-command-events";
import { DocumentLinkAccessFields } from "@/components/document-link-access-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserSearchField } from "@/components/user-search-field";
import {
  removeCollaboratorAction,
  shareDocumentAction,
  updateCollaboratorRoleAction,
  updateDocumentShareLinkAction,
} from "@/server/documents";

type ShareUser = {
  id: string;
  name: string | null;
  username?: string | null;
  email: string | null;
  image?: string | null;
};

type Collaborator = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
};

type FolderCollaborator = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  folderName: string;
};

type ActiveShareLink = {
  id: string;
  scope: "anyone" | "members";
  role: "viewer" | "editor";
  createdAt: Date;
} | null;

export function DocumentShareDialog({
  documentId,
  collaborators,
  folderCollaborators = [],
  friends,
  activeShareLink,
}: {
  documentId: string;
  collaborators: Collaborator[];
  folderCollaborators?: FolderCollaborator[];
  friends: ShareUser[];
  activeShareLink: ActiveShareLink;
}) {
  const currentMode = activeShareLink
    ? `${activeShareLink.scope}-${activeShareLink.role}`
    : "off";
  const priorityUsers = friends.map((friend) => ({
    id: friend.id,
    nickname: friend.name,
    username: friend.username ?? null,
    email: friend.email,
    image: friend.image ?? null,
    priorityLabel: "Friend",
  }));
  const [open, setOpen] = useState(false);

  // Opened directly by the `/share` command palette action, including the case
  // where this dialog was just mounted by revealing the context panel.
  useEffect(() => {
    const reveal = () => setOpen(true);

    if (consumePendingDocumentCommand(["open-share"])) {
      reveal();
    }

    return subscribeToDocumentCommand((type) => {
      if (type === "open-share") {
        reveal();
      }
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <Share2 className="size-4" />
        Share
      </DialogTrigger>
      <DialogContent className="max-h-[min(88dvh,48rem)] overflow-hidden rounded-lg border border-border/70 bg-background/95 p-0 shadow-2xl sm:max-w-2xl">
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5">
          <DialogTitle>Share document</DialogTitle>
          <DialogDescription>
            Invite people directly or create temporary access through a link.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(min(88dvh,48rem)-5.8rem)] overflow-y-auto px-5 py-5">
          <section>
            <h3 className="text-sm font-semibold">Invite people</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Friends appear first, then other matching Vault users.
            </p>
            <form action={shareDocumentAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto]">
              <input type="hidden" name="documentId" value={documentId} />
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
              <Button type="submit">Invite</Button>
            </form>
          </section>

          <section className="mt-6 border-t border-border/60 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">People with access</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Direct shares stay until removed.
                </p>
              </div>
            </div>
            <div className="mt-3 divide-y divide-border/60 rounded-md border border-border/60">
              {collaborators.map((collaborator) => (
                <div
                  key={collaborator.userId}
                  className="grid items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_2rem]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {collaborator.name ?? collaborator.email ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {collaborator.email}
                    </p>
                  </div>

                  {collaborator.role === "owner" ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      owner
                    </span>
                  ) : (
                    <form
                      action={updateCollaboratorRoleAction}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="documentId" value={documentId} />
                      <input
                        type="hidden"
                        name="userId"
                        value={collaborator.userId}
                      />
                      <select
                        name="role"
                        className="h-8 w-full rounded-md border border-border/70 bg-background/70 px-2 text-xs"
                        defaultValue={collaborator.role}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <Button type="submit" variant="ghost" size="xs">
                        Save
                      </Button>
                    </form>
                  )}

                  {collaborator.role === "owner" ? (
                    <span />
                  ) : (
                    <form action={removeCollaboratorAction}>
                      <input type="hidden" name="documentId" value={documentId} />
                      <input
                        type="hidden"
                        name="userId"
                        value={collaborator.userId}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove collaborator"
                        title="Remove collaborator"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </section>

          {folderCollaborators.length > 0 ? (
            <section className="mt-6 border-t border-border/60 pt-5">
              <h3 className="text-sm font-semibold">Through folders</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                These people already have access because a folder containing this
                document is shared with them. Manage them from the folder.
              </p>
              <div className="mt-3 divide-y divide-border/60 rounded-md border border-border/60">
                {folderCollaborators.map((collaborator) => (
                  <div
                    key={`${collaborator.userId}-${collaborator.folderName}`}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {collaborator.name ??
                          collaborator.email ??
                          "Unnamed user"}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Folder className="size-3 shrink-0" />
                        via {collaborator.folderName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {collaborator.role}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-6 border-t border-border/60 pt-5">
            <h3 className="text-sm font-semibold">Link access</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The URL stays the same while these settings control who can use
              it.
            </p>
            <form action={updateDocumentShareLinkAction} className="mt-4 grid gap-3">
              <input type="hidden" name="documentId" value={documentId} />
              <DocumentLinkAccessFields
                currentMode={currentMode}
                activeShareLinkId={activeShareLink?.id ?? null}
              />
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
