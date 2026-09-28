"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { PreviewCard } from "@base-ui/react/preview-card";

import { cn } from "@/lib/utils";

/**
 * The hover card for a wiki link that an extension previews
 * (`docs/23_EXTENSION_SDK_PLAN.md` §6 links; the dictionary's definition cards
 * are the first use). Hovering the link shows a rendered miniature of what it
 * points at, so a reader never has to leave the sentence.
 *
 * Two entry points, one popup:
 *
 * - `LinkPreviewCard` wraps a link on a read surface, where Base UI owns the
 *   trigger and therefore the hover timing, the `safePolygon` path into the
 *   card, focus handling and dismissal.
 * - `LinkHoverCard` is the Live-mode form, anchored to a CodeMirror span that
 *   is not a React element. There is no trigger for Base UI to attach to, so
 *   the hover timing lives in the editor extension (`live-link-hover.ts`),
 *   which keeps the card open by checking whether it is `:hover`ed.
 *
 * Both render `LinkCardPopup`, so the surfaces cannot drift.
 *
 * Previews arrive as React nodes, not Markdown: this module would otherwise
 * have to import `MarkdownDocument`, which imports this one, and that cycle
 * resolves to `undefined` at module init rather than failing loudly. The
 * caller renders the Markdown with links disabled, which also caps preview
 * depth at zero.
 *
 * The CSS classes keep their original `vault-md-definition-*` names: they are
 * part of the stylesheet contract (`docs/CSS_CONTRACT.md`).
 */
export function LinkPreviewCard({
  href,
  title,
  preview,
  quiet = false,
  children,
}: {
  href: string;
  /** The card's heading. */
  title: string;
  preview: ReactNode;
  /** Still linked and previewable, but not emphasized (e.g. a repeat mention). */
  quiet?: boolean;
  /** The link text as it appears in the sentence. */
  children: ReactNode;
}) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={href}
        className={cn(
          "vault-md-link vault-md-definition-link",
          quiet && "vault-md-definition-link--quiet",
        )}
        // The 600ms default reads as unresponsive for a term you are reading
        // past; 250ms is quick enough to feel connected to the hover and still
        // long enough that sweeping the cursor across a paragraph opens nothing.
        delay={250}
      >
        {children}
      </PreviewCard.Trigger>
      <LinkCardPopup title={title} footer={<LinkCardOpenLink href={href} />}>
        {preview}
      </LinkCardPopup>
    </PreviewCard.Root>
  );
}

export function LinkHoverCard({
  anchor,
  title,
  footer,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  title: string;
  footer?: ReactNode;
  /** Escape or an outside press — the extension closes on its own otherwise. */
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <PreviewCard.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <LinkCardPopup anchor={anchor} title={title} footer={footer}>
        {children}
      </LinkCardPopup>
    </PreviewCard.Root>
  );
}

/** "Open" — the way out of a card and into the linked document itself. */
export function LinkCardOpenLink({ href }: { href: string }) {
  return (
    <Link href={href} className="vault-md-definition-card-action">
      Open
    </Link>
  );
}

function LinkCardPopup({
  anchor,
  title,
  footer,
  children,
}: {
  anchor?: HTMLElement;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner
        anchor={anchor}
        sideOffset={8}
        side="top"
        align="start"
      >
        <PreviewCard.Popup className="vault-md-definition-card">
          <p className="vault-md-definition-card-title">{title}</p>
          <div className="vault-md-definition-card-body">{children}</div>
          {footer ? (
            <div className="vault-md-definition-card-footer">{footer}</div>
          ) : null}
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}
