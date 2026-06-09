import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, History, RotateCcw, Save, Trash2 } from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { DocumentWorkspace } from "@/components/document-workspace";
import { DocumentShareDialog } from "@/components/document-share-dialog";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { createCollabToken } from "@/lib/collab-token";
import { cn } from "@/lib/utils";
import {
  archiveDocumentAction,
  createManualDocumentVersionAction,
  getActiveDocumentShareLinkForUser,
  getDocumentForUserWithOptionalShareLink,
  listDocumentCollaborators,
  listDocumentVersionsForUser,
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
  publishDocumentAction,
  restoreDocumentVersionAction,
  unpublishDocumentAction,
} from "@/server/documents";
import { listFriendsForUser } from "@/server/friends";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
import { requireCompletedProfile } from "@/server/profile";

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const { docId } = await params;
  const { share: shareLinkId } = await searchParams;
  const document = await getDocumentForUserWithOptionalShareLink(
    session.user.id,
    docId,
    shareLinkId,
  );

  if (!document) {
    notFound();
  }

  const collaborators = document.access.canShare
    ? await listDocumentCollaborators(document.id, session.user.id)
    : [];
  const activeShareLink = document.access.canShare
    ? await getActiveDocumentShareLinkForUser(document.id, session.user.id)
    : null;
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
            {document.access.canShare ? (
              <DocumentShareDialog
                documentId={document.id}
                collaborators={collaborators}
                friends={friends}
                activeShareLink={activeShareLink}
              />
            ) : null}
          </div>
        </header>

        <DocumentWorkspace
          editor={
            <div className="vault-fade-up px-0 sm:px-2">
              {document.access.canEdit ? (
                <MarkdownEditor
                  documentId={document.id}
                  title={document.title}
                  markdown={markdown}
                  shareLinkId={shareLinkId}
                  wikiLinks={wikiLinks}
                  collaboration={
                    collabToken && collabUrl && !shareLinkId
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
                  <div className="border-y border-border/50 py-5 sm:border-y-0 sm:py-6">
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
                <section className="vault-fade-up rounded-lg border border-border/60 bg-card/70 p-5 text-card-foreground shadow-[0_18px_60px_-55px_rgba(0,0,0,0.55)] backdrop-blur">
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

                  <details className="group mt-4 rounded-md border border-border/60 bg-background/50">
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
                            className="rounded-md border border-border/60 bg-background/60 p-4"
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
                        <div className="rounded-md border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
                          No restore points yet. Create one manually, or keep editing and
                          Vault will create batched checkpoints.
                        </div>
                      )}
                    </div>
                  </details>
                </section>
              ) : null}

              {document.access.canDelete ? (
                <div className="vault-fade-up vault-delay-1 rounded-lg border border-border/60 bg-card/70 p-5 text-card-foreground shadow-[0_18px_60px_-55px_rgba(0,0,0,0.55)] backdrop-blur">
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
