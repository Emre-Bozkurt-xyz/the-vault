"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { LinkPreviewCard } from "@/components/markdown/LinkPreviewCard";
import type { DocumentExtensions, WikiLinkInfo } from "@/lib/extension-api";
import { resolveLinkPreview } from "@/lib/extension-host/links";

// Loaded, not imported: this is a client component on every read surface, and a
// static import would put the whole client Markdown stack (react-markdown,
// KaTeX, highlighting) in every public page's entry. Still server-rendered; the
// chunk loads only on pages that actually show a card.
const MarkdownDocument = dynamic(() =>
  import("@/components/markdown/MarkdownDocument").then((mod) => mod.MarkdownDocument),
);

/**
 * A wiki link on a read surface, handed to extensions' link previews
 * (`docs/23_EXTENSION_SDK_PLAN.md` §6). A client component so that
 * server-rendered documents never import render modules themselves; the
 * decision runs during server rendering all the same, so the card's trigger
 * is in the HTML.
 *
 * Without a preview, it renders `fallback`: the plain link exactly as the
 * renderer would have drawn it.
 */
export function ExtensionLinkHost({
  link,
  extensions,
  fallback,
  children,
}: {
  link: WikiLinkInfo;
  extensions: DocumentExtensions | null;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const resolved = link.href ? resolveLinkPreview(link, extensions) : null;

  if (!resolved || !link.href) {
    return <>{fallback}</>;
  }

  const { preview } = resolved;

  return (
    <LinkPreviewCard
      href={link.href}
      title={preview.title}
      quiet={preview.quiet}
      preview={
        preview.markdown ? (
          // `disableLinks` is also what caps preview depth at zero: every link
          // inside a card renders as plain text, so no card can open another.
          <MarkdownDocument
            markdown={preview.markdown}
            disableLinks
            compact
            contained={false}
          />
        ) : (
          <p className="vault-md-definition-card-empty">{preview.emptyText ?? ""}</p>
        )
      }
    >
      {children}
    </LinkPreviewCard>
  );
}
