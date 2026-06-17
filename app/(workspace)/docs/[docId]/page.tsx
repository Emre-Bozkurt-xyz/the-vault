import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Archive, ChevronDown, Globe2, History, RotateCcw, Save, Share2 } from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { DocumentPublishControl } from "@/components/document-publish-control";
import { DocumentShareDialog } from "@/components/document-share-dialog";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { createCollabToken } from "@/lib/collab-token";
import {
  listAssetResolutionsForDocument,
  listPrivateEmbeddedAssetsForPublish,
} from "@/server/assets";
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

  const [
    readableWikiLinks,
    guideWikiLinks,
    publicWikiLinks,
    collaborators,
    activeShareLink,
    friends,
    versions,
    assetLinks,
    privateEmbeddedAssets,
  ] =
    await Promise.all([
      listWikiLinkResolutionsForUser(session.user.id),
      listOfficialDocWikiLinkResolutions(),
      listPublicWikiLinkResolutions(),
      document.access.canShare
        ? listDocumentCollaborators(document.id, session.user.id)
        : Promise.resolve([]),
      document.access.canShare
        ? getActiveDocumentShareLinkForUser(document.id, session.user.id)
        : Promise.resolve(null),
      document.access.canShare
        ? listFriendsForUser(session.user.id)
        : Promise.resolve([]),
      document.access.canEdit
        ? listDocumentVersionsForUser(document.id, session.user.id)
        : Promise.resolve([]),
      listAssetResolutionsForDocument(document.id, session.user.id),
      document.access.canPublish
        ? listPrivateEmbeddedAssetsForPublish({
            documentId: document.id,
            markdown: document.markdown,
          })
        : Promise.resolve([]),
    ]);
  const wikiLinks = {
    ...readableWikiLinks,
    ...publicWikiLinks,
    ...guideWikiLinks,
  };
  const markdown = document.markdown;
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL ?? null;
  const collabRole = document.access.canEdit
    ? document.access.role === "owner"
      ? "owner"
      : "editor"
    : null;
  const collabToken =
    document.access.canEdit && collabRole && collabUrl
      ? createCollabToken({
          documentId: document.id,
          userId: session.user.id,
          role: collabRole,
          name: profile.nickname ?? null,
          email: profile.email ?? null,
          image: session.user.image ?? null,
          shareLinkId: shareLinkId ?? null,
        })
      : null;
  const documentHref = shareLinkId
    ? `/docs/${document.id}?share=${encodeURIComponent(shareLinkId)}`
    : `/docs/${document.id}`;
  const showRightPanel =
    document.access.canShare || document.access.canEdit || document.access.canDelete;

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "document",
          title: document.title,
          href: documentHref,
        }}
        documentItem={{
          id: document.id,
          title: document.title,
          href: `/docs/${document.id}`,
          updatedAt: document.updatedAt,
          visibility: document.visibility,
          role: document.access.role ?? "viewer",
        }}
        rightPanel={
          showRightPanel ? (
          <DocumentContextPanel
            documentId={document.id}
            visibility={document.visibility}
            publicSlug={document.publicSlug}
            role={document.access.role ?? "viewer"}
            canShare={document.access.canShare}
            canEdit={document.access.canEdit}
            canDelete={document.access.canDelete}
            canPublish={document.access.canPublish}
            collaborators={collaborators}
            friends={friends}
            activeShareLink={activeShareLink}
            versions={versions}
            privateEmbeddedAssets={privateEmbeddedAssets}
          />
          ) : undefined
        }
      />
      <div className="vault-fade-up min-h-full">
        {document.access.canEdit ? (
          <MarkdownEditor
            documentId={document.id}
            title={document.title}
            markdown={markdown}
            shareLinkId={shareLinkId}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            collaboration={
              collabToken && collabUrl
                ? {
                    url: collabUrl,
                    token: collabToken,
                    user: {
                      name: profile.nickname ?? profile.email ?? "Vault user",
                      email: profile.email ?? null,
                      image: session.user.image ?? null,
                    },
                  }
                : null
            }
          />
        ) : (
          <article className="mx-auto grid min-h-full w-full max-w-[56rem] gap-8 px-4 py-10 md:px-8 md:py-14">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight vault-display sm:text-5xl">
                {document.title}
              </h1>
            </div>
            <MarkdownDocument
              markdown={markdown}
              wikiLinks={wikiLinks}
              assetLinks={assetLinks}
            />
          </article>
        )}
      </div>
    </>
  );
}

type DocumentContextPanelProps = {
  documentId: string;
  visibility: "private" | "public";
  publicSlug: string | null;
  role: string;
  canShare: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  collaborators: Awaited<ReturnType<typeof listDocumentCollaborators>>;
  friends: Awaited<ReturnType<typeof listFriendsForUser>>;
  activeShareLink: Awaited<ReturnType<typeof getActiveDocumentShareLinkForUser>>;
  versions: Awaited<ReturnType<typeof listDocumentVersionsForUser>>;
  privateEmbeddedAssets: Awaited<ReturnType<typeof listPrivateEmbeddedAssetsForPublish>>;
};

function DocumentContextPanel({
  documentId,
  visibility,
  publicSlug,
  role,
  canShare,
  canEdit,
  canDelete,
  canPublish,
  collaborators,
  friends,
  activeShareLink,
  versions,
  privateEmbeddedAssets,
}: DocumentContextPanelProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3 text-sm">
      <div className="border-b border-border/70 pb-3">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Document
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">
            {visibility}
          </span>
          <span className="rounded border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium">
            {role}
          </span>
        </div>
      </div>

      {canShare ? (
        <section className="border-b border-border/70 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium">Sharing</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                People, roles, and link access.
              </p>
            </div>
            <Share2 className="size-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-3">
            <DocumentShareDialog
              documentId={documentId}
              collaborators={collaborators}
              friends={friends}
              activeShareLink={activeShareLink}
            />
          </div>
        </section>
      ) : null}

      {canDelete ? (
        <section className="border-b border-border/70 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium">Publish</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Public read-only page.
              </p>
            </div>
            <Globe2 className="size-4 shrink-0 text-muted-foreground" />
          </div>

          <div className="mt-3 grid gap-2">
            {canPublish ? (
              visibility === "public" ? (
                <>
                  {publicSlug ? (
                    <div className="grid gap-2">
                      <Link
                        href={`/public/${publicSlug}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        View public page
                      </Link>
                      <CopyPublicLink path={`/public/${publicSlug}`} />
                    </div>
                  ) : null}
                  <form action={unpublishDocumentAction}>
                    <input type="hidden" name="documentId" value={documentId} />
                    <Button type="submit" variant="ghost" size="sm" className="w-full">
                      Unpublish
                    </Button>
                  </form>
                </>
              ) : (
                <DocumentPublishControl
                  documentId={documentId}
                  privateAssets={privateEmbeddedAssets}
                  action={publishDocumentAction}
                />
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Only owners can publish.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="border-b border-border/70 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium">History</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Batched restore points.
              </p>
            </div>
            <History className="size-4 shrink-0 text-muted-foreground" />
          </div>

          <form action={createManualDocumentVersionAction} className="mt-3">
            <input type="hidden" name="documentId" value={documentId} />
            <Button type="submit" variant="outline" size="sm" className="w-full gap-2">
              <Save className="size-3.5" />
              Create point
            </Button>
          </form>

          <details className="group mt-3 border border-border/70 bg-background/35">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
              <span>Restore points</span>
              <span className="ml-auto text-muted-foreground">{versions.length}</span>
              <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-2 border-t border-border/70 p-2">
              {versions.length > 0 ? (
                versions.map((version) => (
                  <div
                    key={version.id}
                    className="border border-border/60 bg-card/30 p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {version.title}
                        </p>
                        <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                          {version.createdAt.toLocaleString()}
                        </p>
                      </div>
                      <span className="shrink-0 text-[0.66rem] text-muted-foreground">
                        {version.markdownLength.toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[0.68rem] leading-4 text-muted-foreground">
                      {version.markdownPreview.trim() || "Empty document"}
                    </p>
                    <form action={restoreDocumentVersionAction} className="mt-2">
                      <input type="hidden" name="documentId" value={documentId} />
                      <input type="hidden" name="versionId" value={version.id} />
                      <Button
                        type="submit"
                        size="xs"
                        variant="ghost"
                        className="h-7 w-full gap-1.5"
                      >
                        <RotateCcw className="size-3" />
                        Restore
                      </Button>
                    </form>
                  </div>
                ))
              ) : (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  No restore points yet.
                </p>
              )}
            </div>
          </details>
        </section>
      ) : null}

      {canDelete ? (
        <section className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium">Archive</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Remove from active lists.
              </p>
            </div>
            <Archive className="size-4 shrink-0 text-muted-foreground" />
          </div>
          <form action={archiveDocumentAction} className="mt-3">
            <input type="hidden" name="documentId" value={documentId} />
            <Button type="submit" variant="destructive" size="sm" className="w-full">
              Archive document
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
