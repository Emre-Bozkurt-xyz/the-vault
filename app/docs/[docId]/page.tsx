import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, History, RotateCcw, Save, Trash2 } from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { DocumentWorkspace } from "@/components/document-workspace";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { UserSearchField } from "@/components/user-search-field";
import { createCollabToken } from "@/lib/collab-token";
import { cn } from "@/lib/utils";
import {
  archiveDocumentAction,
  createManualDocumentVersionAction,
  getDocumentForUser,
  listDocumentCollaborators,
  listDocumentVersionsForUser,
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
  publishDocumentAction,
  removeCollaboratorAction,
  restoreDocumentVersionAction,
  shareDocumentAction,
  shareDocumentWithFriendAction,
  unpublishDocumentAction,
  updateCollaboratorRoleAction,
} from "@/server/documents";
import { listFriendsForUser } from "@/server/friends";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
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
  const [readableWikiLinks, guideWikiLinks, publicWikiLinks] =
    await Promise.all([
      listWikiLinkResolutionsForUser(session.user.id),
      listOfficialDocWikiLinkResolutions(),
      listPublicWikiLinkResolutions(),
    ]);
  const wikiLinks = {
    ...readableWikiLinks,
    ...publicWikiLinks,
    ...guideWikiLinks,
  };
  const friends = document.access.canShare
    ? await listFriendsForUser(session.user.id)
    : [];
  const versions = document.access.canEdit
    ? await listDocumentVersionsForUser(document.id, session.user.id)
    : [];
  const showSidePanel =
    document.access.canEdit || document.access.canDelete || document.access.canShare;
  const markdown = document.markdown;
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
      <div className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col gap-5 px-0 py-4 sm:gap-8 sm:px-6 sm:py-8 2xl:px-10">
        <header className="mx-3 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4 sm:mx-0 sm:gap-4 sm:pb-6">
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

        <DocumentWorkspace
          editor={
            <div className="vault-fade-up border-y border-border/60 bg-card/70 p-0 shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur sm:rounded-3xl sm:border sm:p-6">
              {document.access.canEdit ? (
                <MarkdownEditor
                  documentId={document.id}
                  title={document.title}
                  markdown={markdown}
                  wikiLinks={wikiLinks}
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
                  <div className="rounded-2xl border border-border/60 bg-background/70 p-4 sm:rounded-3xl sm:p-6">
                    <MarkdownDocument markdown={markdown} wikiLinks={wikiLinks} />
                  </div>
                </article>
              )}
            </div>
          }
          sidePanel={
            showSidePanel ? (
              <>
              {document.access.canEdit ? (
                <section className="vault-fade-up rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        History
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Restore points are batched, not saved for every keystroke.
                      </p>
                    </div>
                    <History className="mt-1 size-4 text-muted-foreground" />
                  </div>

                  <form action={createManualDocumentVersionAction} className="mt-4">
                    <input type="hidden" name="documentId" value={document.id} />
                    <Button type="submit" variant="outline" className="w-full gap-2">
                      <Save className="size-4" />
                      Create restore point
                    </Button>
                  </form>

                  <details className="group mt-4 rounded-2xl border border-border/60 bg-background/50">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                      <span>
                        Restore points
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {versions.length}
                        </span>
                      </span>
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>

                    <div className="grid gap-3 border-t border-border/60 p-3">
                      {versions.length > 0 ? (
                        versions.map((version) => (
                          <div
                            key={version.id}
                            className="rounded-2xl border border-border/60 bg-background/60 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {version.title}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {version.createdAt.toLocaleString()} -{" "}
                                  {formatVersionReason(version.reason)}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {version.createdByName ??
                                    version.createdByEmail ??
                                    "Vault"}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                                {version.markdownLength.toLocaleString()} chars
                              </span>
                            </div>
                            <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                              {version.markdownPreview.trim() || "Empty document"}
                            </p>
                            <form action={restoreDocumentVersionAction} className="mt-3">
                              <input type="hidden" name="documentId" value={document.id} />
                              <input type="hidden" name="versionId" value={version.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                className="w-full gap-2"
                              >
                                <RotateCcw className="size-3.5" />
                                Restore this point
                              </Button>
                            </form>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
                          No restore points yet. Create one manually, or keep editing and
                          Vault will create batched checkpoints.
                        </div>
                      )}
                    </div>
                  </details>
                </section>
              ) : null}

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
                    Add registered users by nickname, username, or email.
                    Viewer can read; editor can read and save changes.
                  </p>

                  <div className="mt-4 space-y-5">
                    <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Share with a user
                      </p>
                      <form
                        action={shareDocumentAction}
                        className="mt-3 grid gap-3"
                      >
                        <input type="hidden" name="documentId" value={document.id} />
                        <UserSearchField
                          placeholder="Nickname, username, or email"
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
              </>
            ) : undefined
          }
        />
      </div>
    </main>
  );
}

function formatVersionReason(reason: string) {
  switch (reason) {
    case "manual":
      return "manual restore point";
    case "collab":
      return "collaboration checkpoint";
    case "before_restore":
      return "before restore";
    case "before_archive":
      return "before archive";
    default:
      return "automatic checkpoint";
  }
}
