"use client";

import { useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { DocumentCanvas } from "@/components/markdown/DocumentCanvas";

type DocumentStylingProps = {
  documentId: string;
  /** Compiled, scope-placeholdered snippet CSS; empty/undefined = none. */
  snippetCss?: string | null;
  nonce?: string;
  /** e.g. "@ada" or a display name; shown in the toggle pill. */
  authorLabel?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Wraps a rendered document body with author CSS snippets and a viewer control.
 * When snippets are present, shows a "Custom styling" pill that toggles them off
 * and on for this view (client-side; removes the scope + <style>). With no
 * snippets it is a transparent passthrough.
 */
export function DocumentStyling({
  documentId,
  snippetCss,
  nonce,
  authorLabel,
  className,
  children,
}: DocumentStylingProps) {
  const hasSnippets = Boolean(snippetCss);
  const [enabled, setEnabled] = useState(true);

  return (
    <>
      {hasSnippets ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setEnabled((value) => !value)}
            aria-pressed={enabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            title={
              enabled
                ? "Turn off the author's custom styling for this view"
                : "Show the author's custom styling"
            }
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {enabled ? "Custom styling on" : "Custom styling off"}
            {authorLabel ? (
              <span className="text-muted-foreground/70">· {authorLabel}</span>
            ) : null}
          </button>
        </div>
      ) : null}
      <DocumentCanvas
        documentId={documentId}
        snippetCss={enabled ? snippetCss : null}
        nonce={nonce}
        className={className}
      >
        {children}
      </DocumentCanvas>
    </>
  );
}
