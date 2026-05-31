import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { ReadOnlyDocument } from "@/components/editor/ReadOnlyDocument";
import { VaultEditor } from "@/components/editor/VaultEditor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { createCollabToken } from "@/lib/collab-token";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  archiveDocumentAction,
  getDocumentForUser,
  listDocumentCollaborators,
  publishDocumentAction,
  removeCollaboratorAction,
  shareDocumentAction,
  shareDocumentWithFriendAction,
  unpublishDocumentAction,
  updateCollaboratorRoleAction,
} from "@/server/documents";
import { listFriendsForUser } from "@/server/friends";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { docId } = await params;
  const document = await getDocumentForUser(session.user.id, docId);

  if (!document) {
    notFound();
  }

  const collaborators = document.access.canShare
    ? await listDocumentCollaborators(document.id, session.user.id)
    : [];
  const friends = document.access.canShare
    ? await listFriendsForUser(session.user.id)
    : [];
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL ?? null;
  const collabRole =
    document.access.role === "owner" || document.access.role === "editor"
      ? document.access.role
      : null;
  const collabToken =
    document.access.canEdit && collabRole && collabUrl
      ? createCollabToken({
          documentId: document.id,
          userId: session.user.id,
          role: collabRole,
          name: session.user.name ?? null,
          email: session.user.email ?? null,
        })
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border pb-5">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {document.visibility === "public" ? (
              <Badge variant="outline">Public</Badge>
            ) : null}
            <Badge variant="outline">{document.access.role ?? "viewer"}</Badge>
          </div>
        </nav>

        <section className="flex-1 py-8">
          {document.access.canEdit ? (
            <VaultEditor
              documentId={document.id}
              title={document.title}
              content={document.content}
              collaboration={
                collabToken && collabUrl
                  ? {
                      url: collabUrl,
                      token: collabToken,
                      user: {
                        name:
                          session.user.name ??
                          session.user.email ??
                          "Vault user",
                        email: session.user.email ?? null,
                      },
                    }
                  : null
              }
            />
          ) : (
            <article className="grid gap-5">
              <h1 className="text-4xl font-semibold tracking-tight">
                {document.title}
              </h1>
              <div className="min-h-[520px] border border-border bg-card p-5 text-card-foreground">
                <ReadOnlyDocument content={document.content} />
              </div>
            </article>
          )}

          {document.access.canDelete ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {document.access.canPublish ? (
                document.visibility === "public" ? (
                  <>
                    {document.publicSlug ? (
                      <>
                        <Link
                          href={`/public/${document.publicSlug}`}
                          className={buttonVariants({ variant: "outline" })}
                        >
                          View public page
                        </Link>
                        <CopyPublicLink path={`/public/${document.publicSlug}`} />
                      </>
                    ) : null}
                    <form action={unpublishDocumentAction}>
                      <input type="hidden" name="documentId" value={document.id} />
                      <Button type="submit" variant="outline">
                        Unpublish
                      </Button>
                    </form>
                  </>
                ) : (
                  <form action={publishDocumentAction}>
                    <input type="hidden" name="documentId" value={document.id} />
                    <Button type="submit" variant="outline">
                      Publish
                    </Button>
                  </form>
                )
              ) : null}
              <form action={archiveDocumentAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <Button type="submit" variant="destructive">
                  <Trash2 className="size-4" />
                  Archive document
                </Button>
              </form>
            </div>
          ) : null}

          {document.access.canShare ? (
            <section className="mt-10 border-t border-border pt-6">
              <h2 className="text-xl font-semibold">Sharing</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add registered users by email. Viewer can read; editor can read
                and save changes.
              </p>

              <form
                action={shareDocumentAction}
                className="mt-4 grid gap-3 border border-border bg-card p-4 sm:grid-cols-[1fr_140px_auto]"
              >
                <input type="hidden" name="documentId" value={document.id} />
                <input
                  name="email"
                  type="email"
                  placeholder="person@example.com"
                  className="h-9 border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  required
                />
                <select
                  name="role"
                  className="h-9 border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  defaultValue="viewer"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <Button type="submit">Share</Button>
              </form>

              {friends.length > 0 ? (
                <form
                  action={shareDocumentWithFriendAction}
                  className="mt-3 grid gap-3 border border-border bg-card p-4 sm:grid-cols-[1fr_140px_auto]"
                >
                  <input type="hidden" name="documentId" value={document.id} />
                  <select
                    name="userId"
                    className="h-9 border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    required
                  >
                    {friends.map((friend) => (
                      <option key={friend.id} value={friend.id}>
                        {friend.name ?? friend.email ?? "Unnamed user"}
                      </option>
                    ))}
                  </select>
                  <select
                    name="role"
                    className="h-9 border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    defaultValue="viewer"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <Button type="submit" variant="outline">
                    Share friend
                  </Button>
                </form>
              ) : null}

              <div className="mt-4 grid gap-2">
                {collaborators.map((collaborator) => (
                  <div
                    key={collaborator.userId}
                    className="flex flex-col gap-3 border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {collaborator.name ?? collaborator.email ?? "Unnamed user"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {collaborator.email} - {collaborator.role}
                      </p>
                    </div>

                    {collaborator.role !== "owner" ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={updateCollaboratorRoleAction}>
                          <input type="hidden" name="documentId" value={document.id} />
                          <input
                            type="hidden"
                            name="userId"
                            value={collaborator.userId}
                          />
                          <select
                            name="role"
                            className="h-8 border border-border bg-background px-2 text-sm"
                            defaultValue={collaborator.role}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">
                            Update
                          </Button>
                        </form>
                        <form action={removeCollaboratorAction}>
                          <input type="hidden" name="documentId" value={document.id} />
                          <input
                            type="hidden"
                            name="userId"
                            value={collaborator.userId}
                          />
                          <Button type="submit" size="sm" variant="destructive">
                            Remove
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
