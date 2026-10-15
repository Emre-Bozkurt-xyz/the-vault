import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  Globe2,
  History,
  Lock,
  Paintbrush,
  RotateCcw,
  Save,
  Share2,
  Sparkles,
} from "lucide-react";

import { auth } from "@/auth";
import { CopyPublicLink } from "@/components/copy-public-link";
import { DocumentArchiveForm } from "@/components/document-archive-form";
import { DocumentPublishControl } from "@/components/document-publish-control";
import { DocumentShareDialog } from "@/components/document-share-dialog";
import { DocumentRestorePoints } from "@/components/document-restore-points";
import { DocumentFolderPath } from "@/components/markdown/DocumentFolderPath";
import { DocumentSnippetsPanel } from "@/components/markdown/DocumentSnippetsPanel";
import { DocumentTasksSection } from "@/components/tasks/DocumentTasksSection";
import { DocumentReadingFrame } from "@/components/markdown/DocumentReadingFrame";
import { DocumentStyling } from "@/components/markdown/DocumentStyling";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { resolveInheritedTagsForDocument } from "@/lib/folder-tags";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ContextPanelBody,
  ContextPanelSection,
} from "@/components/workspace/ContextPanel";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { createCollabToken } from "@/lib/collab-token";
import { ExtensionOverlaySurface } from "@/components/extensions/ExtensionOverlays";
import { resolveDocumentExtensions } from "@/server/extension-runtime";
import {
  listAssetResolutionsForDocument,
  listPrivateEmbeddedAssetsForPublish,
} from "@/server/assets";
import {
  createManualDocumentVersionAction,
  listPublicWikiLinkResolutions,
  publishDocumentAction,
  restoreDocumentVersionAction,
  unpublishDocumentAction,
} from "@/server/documents";
import {
  getActiveDocumentShareLinkForUser,
  getDocumentForUserWithOptionalShareLink,
  listDocumentCollaborators,
  listDocumentFolderCollaborators,
  listDocumentVersionsForUser,
  listWikiLinkResolutionsForUser,
} from "@/server/documents-data";
import { getFolderPathForUser } from "@/server/folders";
import {
  listFriendsForUser,
} from "@/server/friends-data";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
import { requireCompletedProfile } from "@/server/profile";
import { getUserSetting } from "@/server/user-settings";
import { buildPreferences } from "@/lib/settings/preferences";
import {
  getActiveSnippetCssForDocument,
  getViewerStylingPreference,
  listDocumentSnippetAttachmentsForOwner,
} from "@/server/snippets";
import { getCspNonce } from "@/lib/security/nonce";
import { pruneWikiEmbedBodies } from "@/lib/wiki-links";

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
    folderCollaborators,
    activeShareLink,
    friends,
    versions,
    assetLinks,
    privateEmbeddedAssets,
    documentExtensions,
    editorSetting,
    folderPath,
    inheritedTags,
  ] =
    await Promise.all([
      listWikiLinkResolutionsForUser(session.user.id),
      listOfficialDocWikiLinkResolutions(),
      listPublicWikiLinkResolutions(),
      document.access.canShare
        ? listDocumentCollaborators(document.id, session.user.id)
        : Promise.resolve([]),
      document.access.canShare
        ? listDocumentFolderCollaborators(document.id, session.user.id)
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
      listAssetResolutionsForDocument(
        document.id,
        session.user.id,
        document.markdown,
      ),
      document.access.canPublish
        ? listPrivateEmbeddedAssetsForPublish({
            documentId: document.id,
            markdown: document.markdown,
          })
        : Promise.resolve([]),
      // Which extensions the viewer enabled (and their settings), what this
      // document needs rendered, prefetched state and render data such as the
      // FX table for `:calc` — one object instead of a prop per extension.
      resolveDocumentExtensions({
        surface: "workspace",
        document: { id: document.id, markdown: document.markdown },
        canEdit: document.access.canEdit,
        userId: session.user.id,
      }),
      document.access.canEdit
        ? getUserSetting({ userId: session.user.id, namespace: "editor", key: "defaults" })
        : Promise.resolve(null),
      getFolderPathForUser(document.folderId),
      resolveInheritedTagsForDocument(document.id),
    ]);
  const slashMenuEnabled = buildPreferences(
    editorSetting ? [editorSetting] : [],
  ).editor.slashMenu;
  // Only bodies this document transcludes travel with the page.
  const wikiLinks = pruneWikiEmbedBodies(
    {
      ...readableWikiLinks,
      ...publicWikiLinks,
      ...guideWikiLinks,
    },
    document.markdown,
  );
  const markdown = document.markdown;
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL ?? null;
  // Attached snippet CSS applies to the rendered read view and to the editor's
  // Read mode (so owners can preview their styling). The global viewer opt-out
  // only affects other authors' styling in the non-owner read view.
  const attachedSnippetCss = await getActiveSnippetCssForDocument(document.id);
  const cspNonce = attachedSnippetCss ? await getCspNonce() : undefined;

  const applyStyling = document.access.canEdit
    ? true
    : await getViewerStylingPreference(session.user.id);
  const readViewSnippetCss = applyStyling ? attachedSnippetCss : "";
  const editorSnippetCss = document.access.canEdit ? attachedSnippetCss : "";

  const snippetAttachments =
    document.access.role === "owner"
      ? await listDocumentSnippetAttachmentsForOwner(
          session.user.id,
          document.id,
        )
      : null;

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
  const tasksEnabled = documentExtensions.enabledIds.includes("vault.tasks");
  const showRightPanel =
    document.access.canShare || document.access.canEdit || document.access.canDelete || tasksEnabled;

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
        documentCommand={{
          id: document.id,
          title: document.title,
          visibility: document.visibility,
          publicSlug: document.publicSlug,
          canEdit: document.access.canEdit,
          canShare: document.access.canShare,
          canPublish: document.access.canPublish,
          canDelete: document.access.canDelete,
          authoringExtensionIds: document.access.canEdit
            ? documentExtensions.enabledIds
            : [],
        }}
        rightPanelTitle="Document"
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
            folderCollaborators={folderCollaborators}
            friends={friends}
            activeShareLink={activeShareLink}
            versions={versions}
            privateEmbeddedAssets={privateEmbeddedAssets}
            snippetAttachments={snippetAttachments}
            tasksEnabled={tasksEnabled}
          />
          ) : undefined
        }
      />
      <div className="vault-fade-up min-h-full">
        {document.access.canEdit ? (
          <MarkdownEditor
            extensions={documentExtensions}
            documentId={document.id}
            title={document.title}
            markdown={markdown}
            folderPath={folderPath}
            folderId={document.folderId}
            inheritedTags={inheritedTags}
            shareLinkId={shareLinkId}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            slashMenuEnabled={slashMenuEnabled}
            snippetCss={editorSnippetCss}
            snippetNonce={cspNonce}
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
            <div className="grid gap-2">
              <DocumentFolderPath path={folderPath} />
              <h1 className="text-4xl font-semibold tracking-tight vault-display sm:text-5xl">
                {document.title}
              </h1>
            </div>
            <DocumentReadingFrame markdown={markdown}>
              {/* Extension overlays (e.g. stickers) for readers too: rendering
                  follows content, whether or not the reader enabled them. */}
              <ExtensionOverlaySurface
                extensions={documentExtensions}
                links={{ wikiLinks, assetLinks }}
              >
              <DocumentStyling
                documentId={document.id}
                snippetCss={readViewSnippetCss}
                nonce={cspNonce}
              >
                <MarkdownDocument
                  markdown={markdown}
                  wikiLinks={wikiLinks}
                  assetLinks={assetLinks}
                  extensions={documentExtensions}
                />
              </DocumentStyling>
              </ExtensionOverlaySurface>
            </DocumentReadingFrame>
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
  folderCollaborators: Awaited<
    ReturnType<typeof listDocumentFolderCollaborators>
  >;
  friends: Awaited<ReturnType<typeof listFriendsForUser>>;
  activeShareLink: Awaited<ReturnType<typeof getActiveDocumentShareLinkForUser>>;
  versions: Awaited<ReturnType<typeof listDocumentVersionsForUser>>;
  privateEmbeddedAssets: Awaited<ReturnType<typeof listPrivateEmbeddedAssetsForPublish>>;
  snippetAttachments: Awaited<
    ReturnType<typeof listDocumentSnippetAttachmentsForOwner>
  >;
  tasksEnabled: boolean;
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
  folderCollaborators,
  friends,
  activeShareLink,
  versions,
  privateEmbeddedAssets,
  snippetAttachments,
  tasksEnabled,
}: DocumentContextPanelProps) {
  return (
    <ContextPanelBody>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-3">
        <Badge variant={visibility === "public" ? "secondary" : "outline"}>
          {visibility === "public" ? <Globe2 /> : <Lock />}
          {visibility === "public" ? "Public" : "Private"}
        </Badge>
        <Badge variant="outline" className="capitalize">
          {role}
        </Badge>
      </div>

      {tasksEnabled ? <DocumentTasksSection documentId={documentId} /> : null}

      {canShare ? (
        <ContextPanelSection
          icon={Share2}
          title="Sharing"
          description="People, roles, and link access."
        >
          <DocumentShareDialog
            documentId={documentId}
            collaborators={collaborators}
            folderCollaborators={folderCollaborators}
            friends={friends}
            activeShareLink={activeShareLink}
          />
        </ContextPanelSection>
      ) : null}

      {canDelete ? (
        <ContextPanelSection
          icon={Globe2}
          title="Publish"
          description={
            visibility === "public"
              ? "Live as a public read-only page."
              : "Share a public read-only page."
          }
        >
          {canPublish ? (
            visibility === "public" ? (
              <>
                {publicSlug ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href={`/public/${publicSlug}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      View page
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
            <p className="text-xs text-muted-foreground">Only owners can publish.</p>
          )}
        </ContextPanelSection>
      ) : null}

      {snippetAttachments ? (
        <ContextPanelSection
          icon={Paintbrush}
          title="Styling"
          description="Your CSS snippets, applied for everyone who views this."
        >
          <DocumentSnippetsPanel
            documentId={documentId}
            initialAttached={snippetAttachments.attached}
            initialAvailable={snippetAttachments.available}
          />
        </ContextPanelSection>
      ) : null}

      {canEdit ? (
        <ContextPanelSection
          icon={History}
          title="History"
          description={
            versions.length === 0
              ? "No restore points yet."
              : "Snapshots you can roll back to."
          }
          action={
            <form action={createManualDocumentVersionAction}>
              <input type="hidden" name="documentId" value={documentId} />
              <Button type="submit" variant="outline" size="xs">
                <Save data-icon="inline-start" />
                Save point
              </Button>
            </form>
          }
        >
          {versions.length > 0 ? (
            <DocumentRestorePoints count={versions.length}>
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="grid gap-1.5 rounded-md border border-border/60 bg-background/40 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{version.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <p className="text-[0.68rem] text-muted-foreground">
                          {version.createdAt.toLocaleString()}
                        </p>
                        {version.reason === "assistant" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
                            <Sparkles className="size-2.5" />
                            via assistant
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-[0.66rem] tabular-nums text-muted-foreground"
                      title="Characters"
                    >
                      {version.markdownLength.toLocaleString()}
                    </span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-[0.68rem] leading-4 text-muted-foreground">
                    {version.markdownPreview.trim() || "Empty document"}
                  </p>
                  <form action={restoreDocumentVersionAction}>
                    <input type="hidden" name="documentId" value={documentId} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <Button type="submit" size="xs" variant="ghost" className="w-full">
                      <RotateCcw data-icon="inline-start" />
                      Restore
                    </Button>
                  </form>
                </div>
              ))}
            </DocumentRestorePoints>
          ) : null}
        </ContextPanelSection>
      ) : null}

      {canDelete ? (
        <ContextPanelSection
          icon={Archive}
          tone="danger"
          title="Archive"
          description="Moves it to the Bin. Restore it from Files until it is deleted."
        >
          <DocumentArchiveForm documentId={documentId} />
        </ContextPanelSection>
      ) : null}
    </ContextPanelBody>
  );
}
