"use client";

import { type ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";

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
 *   which keeps the card open by checking whether it is `:hover`ed — hence no
 *   pointer callbacks here.
 *
 * Both render `DefinitionCardBody`, so the two surfaces cannot drift.
 *
 * The rendered preview arrives as a `preview` **node**, not as Markdown: this
 * module would otherwise have to import `MarkdownDocument`, which imports this
 * one, and that cycle resolves to `undefined` at module init rather than failing
 * loudly. The caller renders it — which is also what keeps the depth cap honest,
 * since the caller renders it with links disabled.
 */
export function DefinitionPreviewCard({
  href,
  label,
  preview,
  children,
}: {
  href: string;
  /** The definition's title, shown as the card's heading. */
  label: string;
  preview: ReactNode;
  /** The link text as it appears in the sentence. */
  children: ReactNode;
}) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={href}
        className="vault-md-link vault-md-definition-link"
        // The 600ms default reads as unresponsive for a term you are reading
        // past; 250ms is quick enough to feel connected to the hover and still
        // long enough that sweeping the cursor across a paragraph opens nothing.
        delay={250}
      >
        {children}
      </PreviewCard.Trigger>
      <DefinitionCardPopup label={label} preview={preview} />
    </PreviewCard.Root>
  );
}

export function DefinitionHoverCard({
  anchor,
  label,
  preview,
  onClose,
}: {
  anchor: HTMLElement;
  label: string;
  preview: ReactNode;
  /** Escape or an outside press — the extension closes on its own otherwise. */
  onClose: () => void;
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
      <DefinitionCardPopup anchor={anchor} label={label} preview={preview} />
    </PreviewCard.Root>
  );
}

function DefinitionCardPopup({
  anchor,
  label,
  preview,
}: {
  anchor?: HTMLElement;
  label: string;
  preview: ReactNode;
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
          <div className="vault-md-definition-card-body">{preview}</div>
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}
