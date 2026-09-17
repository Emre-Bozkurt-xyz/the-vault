"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { PreviewCard } from "@base-ui/react/preview-card";

import { cn } from "@/lib/utils";

/**
 * The hover preview for a link that points at a definition document
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md`). Hovering the term shows a rendered
 * miniature of its definition, so a reader never has to leave the sentence.
 *
 * Two entry points, one popup:
 *
 * - `DefinitionPreviewCard` wraps a link on a read surface, where Base UI owns
 *   the trigger and therefore the hover timing, the `safePolygon` path into the
 *   card, focus handling and dismissal.
 * - `DefinitionHoverCard` is the Live-mode form, anchored to a CodeMirror span
 *   that is not a React element. There is no trigger for Base UI to attach to,
 *   so the hover timing lives in the editor extension (`live-definitions.ts`),
 *   which keeps the card open by checking whether it is `:hover`ed.
 *
 * Both render `DefinitionCardPopup`, so the surfaces cannot drift.
 *
 * Rendered previews arrive as React nodes, not Markdown: this module would
 * otherwise have to import `MarkdownDocument`, which imports this one, and that
 * cycle resolves to `undefined` at module init rather than failing loudly. The
 * caller renders the Markdown with links disabled, which also caps preview depth
 * at zero.
 */
export function DefinitionPreviewCard({
  href,
  label,
  preview,
  quiet = false,
  children,
}: {
  href: string;
  /** The definition's title, shown as the card's heading. */
  label: string;
  preview: ReactNode;
  /**
   * A repeat mention under the reader's "first mention" setting: still linked
   * and still previewable, but not emphasized.
   */
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
      <DefinitionCardPopup
        label={label}
        footer={<DefinitionCardOpenLink href={href} />}
      >
        {preview}
      </DefinitionCardPopup>
    </PreviewCard.Root>
  );
}

export function DefinitionHoverCard({
  anchor,
  label,
  footer,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  label: string;
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
      <DefinitionCardPopup anchor={anchor} label={label} footer={footer}>
        {children}
      </DefinitionCardPopup>
    </PreviewCard.Root>
  );
}

/** "Open" — the way out of a card and into the definition itself. */
export function DefinitionCardOpenLink({ href }: { href: string }) {
  return (
    <Link href={href} className="vault-md-definition-card-action">
      Open
    </Link>
  );
}

function DefinitionCardPopup({
  anchor,
  label,
  footer,
  children,
}: {
  anchor?: HTMLElement;
  label: string;
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
          <p className="vault-md-definition-card-title">{label}</p>
          <div className="vault-md-definition-card-body">{children}</div>
          {footer ? (
            <div className="vault-md-definition-card-footer">{footer}</div>
          ) : null}
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}
