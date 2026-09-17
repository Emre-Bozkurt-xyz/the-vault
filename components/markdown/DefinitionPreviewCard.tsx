"use client";

import { type ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";

/**
 * The hover preview for a link that points at a definition document
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md`). Hovering the term shows a rendered
 * miniature of its definition, so a reader never has to leave the sentence.
 *
 * The rendered preview arrives as a `preview` **node**, not as Markdown: this
 * module would otherwise have to import `MarkdownDocument`, which imports this
 * one, and the resulting cycle is the kind that resolves to `undefined` at
 * module init rather than failing loudly. The caller renders the Markdown and
 * hands it over — which is also what keeps the depth cap honest, since the
 * caller renders it with links disabled.
 *
 * Base UI's preview card supplies the parts that are easy to get wrong by hand:
 * hover-with-delay, a `safePolygon` path so the pointer can travel from the term
 * into the card without it closing, focus and keyboard access, and Escape /
 * outside-press dismissal.
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
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8} side="top" align="start">
          <PreviewCard.Popup className="vault-md-definition-card">
            <p className="vault-md-definition-card-title">{label}</p>
            <div className="vault-md-definition-card-body">{preview}</div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
