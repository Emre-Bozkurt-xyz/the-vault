"use client";

import { useEffect, useState, type ReactNode } from "react";

import { documentExcerpt, parseWikiDocTarget, wikiDocKey } from "@/lib/wiki-links";

// One request per linked document per page; a card opened twice reads the cache.
const excerpts = new Map<string, Promise<string | null>>();

/** The document id a workspace link points at (`/docs/<id>#…`), or null. */
export function linkedDocumentId(href: string | null): string | null {
  const match = href?.match(/^\/docs\/([0-9a-f-]{36})(?:[?#]|$)/i);
  return match ? parseWikiDocTarget(match[1]) : null;
}

function loadExcerpt(documentId: string, href: string): Promise<string | null> {
  const cacheKey = `${documentId}|${href}`;
  let pending = excerpts.get(cacheKey);
  if (!pending) {
    const key = wikiDocKey(documentId);
    pending = fetch(`/api/documents/wiki-links?embed=${encodeURIComponent(key)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { wikiLinks?: Record<string, { embedMarkdown?: string }> } | null) =>
        documentExcerpt(payload?.wikiLinks?.[key]?.embedMarkdown ?? null, href),
      )
      .catch(() => null);
    excerpts.set(cacheKey, pending);
  }
  return pending;
}

/**
 * A linked document's opening (or linked section) in its hover card. Pages
 * only carry the text of documents they embed, so a plain link's card loads
 * it when it opens. Markdown is rendered by the caller (`renderMarkdown`), so
 * this module never imports the renderer that imports it.
 */
export function DocumentExcerptPreview({
  href,
  initial,
  renderMarkdown,
}: {
  href: string;
  /** The excerpt when the page already has the document's text. */
  initial: string | null;
  renderMarkdown: (markdown: string) => ReactNode;
}) {
  const documentId = linkedDocumentId(href);
  const [loaded, setLoaded] = useState<{ href: string; excerpt: string | null } | null>(null);

  useEffect(() => {
    if (initial || !documentId) return;
    let cancelled = false;
    void loadExcerpt(documentId, href).then((excerpt) => {
      if (!cancelled) setLoaded({ href, excerpt });
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, href, initial]);

  const excerpt = initial ?? (loaded?.href === href ? loaded.excerpt : undefined);
  if (excerpt) return <>{renderMarkdown(excerpt)}</>;
  return (
    <p className="vault-md-definition-card-empty">
      {excerpt === undefined && documentId ? "Loading…" : "Nothing written here yet."}
    </p>
  );
}
