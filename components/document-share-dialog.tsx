import { AlertTriangle, Link2, Share2, Trash2 } from "lucide-react";

import { CopyPublicLink } from "@/components/copy-public-link";
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

type ActiveShareLink = {
  id: string;
  scope: "anyone" | "members";
  role: "viewer" | "editor";
  createdAt: Date;
} | null;

export function DocumentShareDialog({
  documentId,
  collaborators,
  friends,
  activeShareLink,
}: {
  documentId: string;
  collaborators: Collaborator[];
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

  return (
    <Dialog>
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

          <section className="mt-6 border-t border-border/60 pt-5">
            <h3 className="text-sm font-semibold">Link access</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Link access is temporary. Disabling or rotating the link removes
              access immediately.
            </p>
            <form action={updateDocumentShareLinkAction} className="mt-4 grid gap-3">
              <input type="hidden" name="documentId" value={documentId} />
              <select
                name="mode"
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                defaultValue={currentMode}
              >
                <option value="off">Off</option>
                <option value="anyone-viewer">Anyone with the link can view</option>
                <option value="members-viewer">
                  Signed-in Vault members with the link can view
                </option>
                <option value="members-editor">
                  Signed-in Vault members with the link can edit
                </option>
              </select>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="outline">
                  <Link2 className="size-4" />
                  Save link settings
                </Button>
                {activeShareLink ? (
                  <CopyPublicLink path={`/share/${activeShareLink.id}`} />
                ) : null}
              </div>
              <div className="flex gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Edit links let any signed-in Vault member with the URL change this
                document until you disable or rotate the link.
              </div>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
