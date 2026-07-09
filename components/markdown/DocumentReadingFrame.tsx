"use client";

import { useMemo, useRef, type ReactNode } from "react";

import { extractMarkdownHeadingOptions } from "@/lib/wiki-links";
import { cn } from "@/lib/utils";
import { DocumentOutline, type OutlineHeading } from "./DocumentOutline";
import { useHeadingScrollSpy } from "./use-heading-scroll-spy";

type DocumentReadingFrameProps = {
  /** Document body used to derive the outline; slugs match rendered heading ids. */
  markdown: string;
  children: ReactNode;
  /** Extra classes for the content cell (e.g. a max-width for the body column). */
  contentClassName?: string;
  className?: string;
  stickyTop?: string;
};

/**
 * Layout wrapper for rendered (non-editor) document surfaces: a sticky outline
 * rail in the left gutter plus the document body. Extracts headings from the
 * markdown, tracks the active heading via scroll-spy, and navigates by scrolling
 * the matching `id` anchor into view. Used by every read surface (public, share,
 * workspace-public, the editor's read view host, and official guides). The
 * outline hides itself when there are fewer than two headings.
 */
export function DocumentReadingFrame({
  markdown,
  children,
  contentClassName,
  className,
  stickyTop,
}: DocumentReadingFrameProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const headings = useMemo<OutlineHeading[]>(
    () => extractMarkdownHeadingOptions(markdown),
    [markdown],
  );
  const slugsKey = useMemo(
    () => headings.map((heading) => heading.slug).join("|"),
    [headings],
  );

  const activeSlug = useHeadingScrollSpy(contentRef, slugsKey);

  const handleSelect = (heading: OutlineHeading) => {
    const root = contentRef.current;
    if (!root) {
      return;
    }
    const target = root.querySelector<HTMLElement>(`#${CSS.escape(heading.slug)}`);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      try {
        window.history.replaceState(null, "", `#${heading.slug}`);
      } catch {
        // Ignore history failures (e.g. sandboxed contexts).
      }
    }
  };

  return (
    <div className={cn("vault-reading-frame", className)}>
      <DocumentOutline
        headings={headings}
        activeSlug={activeSlug}
        onSelect={handleSelect}
        stickyTop={stickyTop}
      />
      <div ref={contentRef} className={cn("vault-reading-content", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
