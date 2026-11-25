"use client";

import { useEffect, useState, type ReactNode } from "react";

import { parseDocumentAppearance } from "@/lib/content-metadata";
import { documentExcerpt, parseWikiDocTarget, wikiDocKey } from "@/lib/wiki-links";

/** The miniature is a page this wide, scaled down to the card. */
const PAGE_WIDTH = 640;
const CARD_WIDTH = 368;
const SCALE = CARD_WIDTH / PAGE_WIDTH;
/** How much of the page a miniature shows. */
const MINIATURE_LIMITS = { lines: 60, chars: 4000 };

type LinkedPage = { title: string | null; markdown: string };

// One request per linked document per page; a card opened twice reads the cache.
const pages = new Map<string, Promise<LinkedPage | null>>();

/** The document id a workspace link points at (`/docs/<id>#…`), or null. */
export function linkedDocumentId(href: string | null): string | null {
  const match = href?.match(/^\/docs\/([0-9a-f-]{36})(?:[?#]|$)/i);
  return match ? parseWikiDocTarget(match[1]) : null;
}

function loadPage(documentId: string): Promise<LinkedPage | null> {
  let pending = pages.get(documentId);
  if (!pending) {
    const key = wikiDocKey(documentId);
    pending = fetch(`/api/documents/wiki-links?embed=${encodeURIComponent(key)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { wikiLinks?: Record<string, { label?: string; embedMarkdown?: string }> } | null) => {
        const resolution = payload?.wikiLinks?.[key];
        return typeof resolution?.embedMarkdown === "string"
          ? { title: resolution.label ?? null, markdown: resolution.embedMarkdown }
          : null;
      })
      .catch(() => null);
    pages.set(documentId, pending);
  }
  return pending;
}

/**
 * A linked document's hover card as a miniature of the page itself: its cover,
 * icon and title over its opening (or the linked section), drawn at page width
 * with the real renderer and scaled down, fading out at the bottom. Pages only
 * carry the text of documents they embed, so a plain link's card loads it when
 * it opens. Markdown is rendered by the caller (`renderMarkdown`), so this
 * module never imports the renderer that imports it.
 */
export function DocumentExcerptPreview({
  href,
  title,
  initial,
  renderMarkdown,
}: {
  href: string;
  /** The link's own title, until the page's is loaded. */
  title: string;
  /** An excerpt when the page already has the document's text. */
  initial: string | null;
  renderMarkdown: (markdown: string) => ReactNode;
}) {
  const documentId = linkedDocumentId(href);
  const [loaded, setLoaded] = useState<{ id: string; page: LinkedPage | null } | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    void loadPage(documentId).then((page) => {
      if (!cancelled) setLoaded({ id: documentId, page });
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const page = loaded?.id === documentId ? loaded.page : null;
  const waiting = Boolean(documentId) && loaded?.id !== documentId && !initial;
  const body = page ? documentExcerpt(page.markdown, href, MINIATURE_LIMITS) : initial;
  const art = page ? parseDocumentAppearance(page.markdown) : { icon: null, coverAssetId: null };

  return (
    <div className="vault-page-miniature" aria-busy={waiting}>
      <div
        className="vault-page-miniature-page"
        style={{ width: PAGE_WIDTH, transform: `scale(${SCALE})` }}
        aria-hidden="true"
      >
        {art.coverAssetId && documentId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="vault-page-miniature-cover"
            src={`/api/assets/${art.coverAssetId}/content?doc=${documentId}&r=display`}
            alt=""
          />
        ) : null}
        {art.icon ? <div className="vault-page-miniature-icon">{art.icon}</div> : null}
        <h1 className="vault-page-miniature-title vault-display">{page?.title || title}</h1>
        {body ? (
          renderMarkdown(body)
        ) : (
          <p className="vault-page-miniature-empty">{waiting ? "" : "Nothing written here yet."}</p>
        )}
      </div>
      {/* Screen readers get the text, not the picture. */}
      <p className="sr-only">{body ?? ""}</p>
    </div>
  );
}
