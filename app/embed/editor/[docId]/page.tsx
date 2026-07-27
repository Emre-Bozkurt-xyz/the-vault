import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { documents, users } from "@/db/schema";
import { EmbedThemeSync } from "@/components/embed/EmbedThemeSync";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { createCollabToken } from "@/lib/collab-token";
import { createEmbedSessionToken } from "@/lib/embed-session-token";
import { getDocumentAccess } from "@/lib/permissions";
import { listAssetResolutionsForDocument } from "@/server/assets";
import { isUserActiveById } from "@/server/authz";
import {
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
import { consumeEmbedBootToken } from "@/server/embed";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.5). This route deliberately lives
// outside `app/(workspace)/` so it inherits only the root layout — no
// sidebar/tab/command-palette chrome mounts. It still gets `ThemeProvider`
// from the root layout, which `EmbedThemeSync` uses to honor `?theme=`.
//
// Auth: this page does NOT call `auth()` / read the Vault session cookie —
// Den frames it cross-origin and iOS Safari blocks third-party cookies. The
// acting user comes entirely from the single-use `?boot=` token
// (`consumeEmbedBootToken`, server/embed.ts). The room token for the live
// Hocuspocus connection is then minted fresh from a real DB permission check
// (`getDocumentAccess`) for that user — never from anything the boot token or
// the client claims about role.
//
// Every cookie-dependent fetch *inside* the rendered editor (saving, private
// asset images, asset completions/link, wiki-link lookups) has the same
// no-cookie problem. Those are bridged with a second, multi-use bearer token
// — the embed session token (`lib/embed-session-token.ts`) — minted here
// once access is confirmed and handed to `MarkdownEditor` as a prop. It never
// leaves this Vault-origin document (Den cannot read it cross-origin), but is
// still treated as a bearer credential: never logged, never put in a
// redirect. Every route that accepts it re-derives access from the DB by
// `vaultUserId` — the token itself is an identity assertion only.
//
// CSP: `frame-ancestors` for this path is set centrally in `proxy.ts` /
// `lib/security/csp.ts` (EMBED_FRAME_ANCESTORS), not here.

type EmbedEditorPageProps = {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ boot?: string; theme?: string }>;
};

export default async function EmbedEditorPage({
  params,
  searchParams,
}: EmbedEditorPageProps) {
  const { docId } = await params;
  const { boot, theme } = await searchParams;

  if (!boot) {
    return <ExpiredSessionView />;
  }

  const bootPayload = await consumeEmbedBootToken(boot);

  // A page refresh or a double-render legitimately fails here: the token was
  // already consumed by the first render. This is expected single-use
  // behavior (docs/DEN_EMBED_BRIDGE.md §C.6), not an error condition — show a
  // clear "reopen from Den" state rather than throwing.
  if (!bootPayload || bootPayload.documentId !== docId) {
    return <ExpiredSessionView />;
  }

  const { vaultUserId } = bootPayload;
  // The ban check mirrors `requireActiveUser()` on the cookie-authenticated
  // document routes, which this page cannot use (it has no session and must
  // not redirect to /banned inside Den's iframe). A banned user gets the same
  // 404 as any other unreadable case.
  const [isActive, access] = await Promise.all([
    isUserActiveById(vaultUserId),
    getDocumentAccess(vaultUserId, docId),
  ]);

  // Unreadable/private -> 404, never a leaked title/snippet (AGENTS.md §4).
  if (!isActive || !access.canRead) {
    notFound();
  }

  const [document] = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
    })
    .from(documents)
    .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    notFound();
  }

  if (!access.canEdit) {
    return <NoLongerEditableView title={document.title} />;
  }

  const [user] = await db
    .select({ name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(eq(users.id, vaultUserId))
    .limit(1);

  // Minted only once we know this user can actually edit — the read-only
  // "no longer editable" view above returns before this point, so nothing
  // downstream of it needs a session token.
  const embedSessionToken = createEmbedSessionToken({
    documentId: docId,
    vaultUserId,
  });

  const [readableWikiLinks, guideWikiLinks, publicWikiLinks, assetLinks] =
    await Promise.all([
      listWikiLinkResolutionsForUser(vaultUserId),
      listOfficialDocWikiLinkResolutions(),
      listPublicWikiLinkResolutions(),
      listAssetResolutionsForDocument(
        docId,
        vaultUserId,
        document.markdown,
        embedSessionToken,
      ),
    ]);
  const wikiLinks = {
    ...readableWikiLinks,
    ...publicWikiLinks,
    ...guideWikiLinks,
  };

  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL ?? null;
  const collabRole = access.role === "owner" ? "owner" : "editor";
  const collabToken = collabUrl
    ? createCollabToken({
        documentId: docId,
        userId: vaultUserId,
        role: collabRole,
        name: user?.name ?? null,
        email: user?.email ?? null,
        image: user?.image ?? null,
        shareLinkId: null,
      })
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <EmbedThemeSync theme={theme ?? null} />
      <MarkdownEditor
        documentId={document.id}
        title={document.title}
        markdown={document.markdown}
        wikiLinks={wikiLinks}
        assetLinks={assetLinks}
        embedSessionToken={embedSessionToken}
        collaboration={
          collabToken && collabUrl
            ? {
                url: collabUrl,
                token: collabToken,
                user: {
                  name: user?.name ?? user?.email ?? "Vault user",
                  email: user?.email ?? null,
                  image: user?.image ?? null,
                },
              }
            : null
        }
      />
    </div>
  );
}

function ExpiredSessionView() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md border border-border bg-card p-8 text-center text-card-foreground">
        <h1 className="text-lg font-semibold">This embed session expired</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Embed links are single-use and expire quickly. Reopen this document
          from Den to continue editing.
        </p>
      </div>
    </main>
  );
}

function NoLongerEditableView({ title }: { title: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md border border-border bg-card p-8 text-center text-card-foreground">
        <h1 className="text-lg font-semibold">No longer editable</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your edit access to &ldquo;{title}&rdquo; was removed. Reopen it from
          Den if access is restored.
        </p>
      </div>
    </main>
  );
}
