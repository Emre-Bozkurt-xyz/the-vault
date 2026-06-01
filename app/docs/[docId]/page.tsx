import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { createCollabToken } from "@/lib/collab-token";
import { normalizeStoredMarkdown } from "@/lib/markdown";
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
import { requireCompletedProfile } from "@/server/profile";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
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
  const showSidePanel = document.access.canDelete || document.access.canShare;
  const markdown = normalizeStoredMarkdown(document.markdown, document.content);
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
          name: profile.nickname ?? null,
          email: profile.email ?? null,
        })
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
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
            ) : (
              <Badge variant="outline">Private</Badge>
            )}
            <Badge variant="secondary">{document.access.role ?? "viewer"}</Badge>
          </div>
        </header>

        <section
          className={cn(
            "grid gap-8",
            showSidePanel ? "lg:grid-cols-[minmax(0,1fr)_320px]" : null,
          )}
        >
          <div className="vault-fade-up rounded-3xl border border-border/60 bg-card/70 p-6 shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
            {document.access.canEdit ? (
              <MarkdownEditor
                documentId={document.id}
                title={document.title}
                markdown={markdown}
                collaboration={
                  collabToken && collabUrl
                    ? {
                        url: collabUrl,
                        token: collabToken,
                        user: {
                          name:
                            profile.nickname ??
                            profile.email ??
                            "Vault user",
                          email: profile.email ?? null,
                        },
                      }
                    : null
                }
              />
            ) : (
              <article className="grid gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Document
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold tracking-tight vault-display">
                    {document.title}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Updated {document.updatedAt.toLocaleDateString()}
                  </p>
                </div>
                <div className="rounded-3xl border border-border/60 bg-background/70 p-6">
                  <MarkdownDocument markdown={markdown} />
                </div>
              </article>
            )}
          </div>

          {showSidePanel ? (
            <aside className="space-y-6">
              {document.access.canDelete ? (
                <div className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Visibility
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Publish this document to share a clean public page.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
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
                  </div>

                  <div className="mt-6 border-t border-border/60 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Archive
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Remove the document from your dashboard view.
                    </p>
                    <form action={archiveDocumentAction} className="mt-3">
                      <input type="hidden" name="documentId" value={document.id} />
                      <Button type="submit" variant="destructive" className="gap-2">
                        <Trash2 className="size-4" />
                        Archive document
                      </Button>
                    </form>
                  </div>
                </div>
              ) : null}

              {document.access.canShare ? (
                <section className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Sharing
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add registered users by email. Viewer can read; editor can
                    read and save changes.
                  </p>

                  <div className="mt-4 space-y-5">
                    <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Share by email
                      </p>
                      <form
                        action={shareDocumentAction}
                        className="mt-3 grid gap-3"
                      >
                        <input type="hidden" name="documentId" value={document.id} />
                        <Input
                          name="email"
                          type="email"
                          placeholder="person@example.com"
                          required
                        />
                        <select
                          name="role"
                          className="h-9 w-full rounded-lg border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          defaultValue="viewer"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <Button type="submit">Share</Button>
                      </form>
                    </div>

                    {friends.length > 0 ? (
                      <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                          Share with a friend
                        </p>
                        <form
                          action={shareDocumentWithFriendAction}
                          className="mt-3 grid gap-3"
                        >
                          <input type="hidden" name="documentId" value={document.id} />
                          <select
                            name="userId"
                            className="h-9 w-full rounded-lg border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                            className="h-9 w-full rounded-lg border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            defaultValue="viewer"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                          <Button type="submit" variant="outline">
                            Share friend
                          </Button>
                        </form>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Collaborators
                      </p>
                      <div className="mt-3 grid gap-3">
                        {collaborators.map((collaborator) => (
                          <div
                            key={collaborator.userId}
                            className="rounded-2xl border border-border/60 bg-background/70 p-4"
                          >
                            <div>
                              <p className="font-medium">
                                {collaborator.name ??
                                  collaborator.email ??
                                  "Unnamed user"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {collaborator.email} - {collaborator.role}
                              </p>
                            </div>

                            {collaborator.role !== "owner" ? (
                              <div className="mt-3 grid gap-2">
                                <form
                                  action={updateCollaboratorRoleAction}
                                  className="grid gap-2"
                                >
                                  <input
                                    type="hidden"
                                    name="documentId"
                                    value={document.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="userId"
                                    value={collaborator.userId}
                                  />
                                  <select
                                    name="role"
                                    className="h-8 w-full rounded-lg border border-border/70 bg-background/70 px-2 text-sm"
                                    defaultValue={collaborator.role}
                                  >
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                  </select>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="outline"
                                    className="w-full"
                                  >
                                    Update role
                                  </Button>
                                </form>
                                <form action={removeCollaboratorAction}>
                                  <input
                                    type="hidden"
                                    name="documentId"
                                    value={document.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="userId"
                                    value={collaborator.userId}
                                  />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="destructive"
                                    className="w-full"
                                  >
                                    Remove collaborator
                                  </Button>
                                </form>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
            </aside>
          ) : null}
        </section>
      </div>
    </main>
  );
}
