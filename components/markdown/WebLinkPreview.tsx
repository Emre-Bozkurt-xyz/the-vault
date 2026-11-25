"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { ExternalLink, Globe2 } from "lucide-react";

import type { LinkPreviewData } from "@/lib/link-preview/parse";

// One request per URL per page; the server caches across pages.
const previews = new Map<string, Promise<LinkPreviewData | null>>();

function loadPreview(url: string): Promise<LinkPreviewData | null> {
  let pending = previews.get(url);
  if (!pending) {
    pending = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { preview?: LinkPreviewData | null } | null) => payload?.preview ?? null)
      .catch(() => null);
    previews.set(url, pending);
  }
  return pending;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A web link's hover card: the page's preview image, site, title and
 * description (its OpenGraph tags, else its `<title>` and description), loaded
 * through the server when the card opens. Falls back to the site's address.
 */
export function WebLinkPreview({ url }: { url: string }) {
  const [state, setState] = useState<{ url: string; preview: LinkPreviewData | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPreview(url).then((preview) => {
      if (!cancelled) setState({ url, preview });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const loading = state?.url !== url;
  const preview = state?.url === url ? state.preview : null;
  const host = hostOf(url);

  return (
    <div className="vault-web-preview" aria-busy={loading}>
      {preview?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="vault-web-preview-image"
          src={preview.image}
          alt=""
          referrerPolicy="no-referrer"
          onError={(event) => event.currentTarget.remove()}
        />
      ) : null}
      <div className="vault-web-preview-text">
        <p className="vault-web-preview-site">
          {preview?.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.favicon} alt="" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />
          ) : (
            <Globe2 aria-hidden="true" />
          )}
          <span>{preview?.siteName ?? host}</span>
        </p>
        {loading ? (
          <>
            <span className="vault-web-preview-skeleton" />
            <span className="vault-web-preview-skeleton vault-web-preview-skeleton--short" />
          </>
        ) : preview?.title || preview?.description ? (
          <>
            {preview.title ? <p className="vault-web-preview-title">{preview.title}</p> : null}
            {preview.description ? <p className="vault-web-preview-description">{preview.description}</p> : null}
          </>
        ) : (
          <p className="vault-web-preview-description">No preview for this page.</p>
        )}
      </div>
    </div>
  );
}

/** "Open" for a web link: a new tab, like following it. */
export function WebLinkOpen({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="vault-md-definition-card-action inline-flex items-center gap-1">
      Open <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

/**
 * A web link on a read surface with its hover card (workspace pages only: the
 * preview route needs a signed-in reader). `children` is the link itself.
 */
export function WebLinkHoverCard({ url, children }: { url: string; children: ReactNode }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger href={url} target="_blank" rel="noreferrer" className="vault-md-link" delay={400}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8} side="top" align="start">
          <PreviewCard.Popup className="vault-md-definition-card vault-md-definition-card--page">
            <WebLinkPreview url={url} />
            <div className="vault-md-definition-card-footer">
              <WebLinkOpen url={url} />
            </div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
