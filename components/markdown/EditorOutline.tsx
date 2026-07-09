"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { extractMarkdownHeadingOptions } from "@/lib/wiki-links";
import { DocumentOutline, type OutlineHeading } from "./DocumentOutline";
import { useHeadingScrollSpy } from "./use-heading-scroll-spy";

type EditorMode = "live" | "source" | "read";

type EditorOutlineProps = {
  markdown: string;
  mode: EditorMode;
  /** The live CodeMirror view (live/source modes). */
  viewRef: RefObject<EditorView | null>;
  /** Increments whenever a new CodeMirror view is created, to re-attach spy. */
  viewEpoch: number;
  /** The rendered read-mode content container (read mode). */
  previewRef: RefObject<HTMLElement | null>;
};

/**
 * Character offset of each heading line, in document order. Mirrors the
 * heading detection in `extractMarkdownAnchorOptions` (same regex + fenced-code
 * skipping), so this list is index-aligned with `extractMarkdownHeadingOptions`
 * — index i here is the offset of heading i there.
 */
function getHeadingLineOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  let inFence = false;
  let offset = 0;

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }
    if (!inFence && /^(#{1,6})\s+(.+?)\s*#*$/.test(line)) {
      offsets.push(offset);
    }
    offset += line.length + 1;
  }

  return offsets;
}

/**
 * Outline for the document editor. Reactive to the current markdown, it drives
 * navigation and active-heading tracking against whichever surface is showing:
 * the CodeMirror document (live/source) via scroll-to-position, or the rendered
 * read-mode preview via anchor scrolling.
 */
export function EditorOutline({
  markdown,
  mode,
  viewRef,
  viewEpoch,
  previewRef,
}: EditorOutlineProps) {
  const headings = useMemo<OutlineHeading[]>(
    () => extractMarkdownHeadingOptions(markdown),
    [markdown],
  );
  const offsetBySlug = useMemo(() => {
    const offsets = getHeadingLineOffsets(markdown);
    const map = new Map<string, number>();
    headings.forEach((heading, index) => {
      if (offsets[index] != null) {
        map.set(heading.slug, offsets[index]);
      }
    });
    return map;
  }, [markdown, headings]);
  const slugsKey = useMemo(
    () => headings.map((heading) => heading.slug).join("|"),
    [headings],
  );

  const isReadMode = mode === "read";

  // Read mode: DOM scroll-spy over the rendered heading anchors.
  const domActiveSlug = useHeadingScrollSpy(previewRef, isReadMode ? slugsKey : "");

  // Live/source: track the heading nearest the top of the viewport using the
  // CodeMirror height map (works even for lines outside the rendered viewport).
  const [cmActiveSlug, setCmActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (isReadMode) {
      return;
    }
    const view = viewRef.current;
    if (!view) {
      return;
    }

    let frame = 0;
    const compute = () => {
      frame = 0;
      let active: string | null = null;
      for (const heading of headings) {
        const pos = offsetBySlug.get(heading.slug);
        if (pos == null) {
          continue;
        }
        const clamped = Math.min(pos, view.state.doc.length);
        const top = view.documentTop + view.lineBlockAt(clamped).top;
        if (top - 130 <= 0) {
          active = heading.slug;
        } else {
          break;
        }
      }
      setCmActiveSlug(active ?? headings[0]?.slug ?? null);
    };

    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(compute);
      }
    };

    compute();
    // Capture phase so the workspace <main> scroll (the real scroller) is caught.
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [isReadMode, headings, offsetBySlug, viewRef, viewEpoch]);

  const handleSelect = useCallback(
    (heading: OutlineHeading) => {
      if (isReadMode) {
        const root = previewRef.current;
        const target = root?.querySelector<HTMLElement>(
          `#${CSS.escape(heading.slug)}`,
        );
        target?.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }

      const view = viewRef.current;
      const pos = offsetBySlug.get(heading.slug);
      if (!view || pos == null) {
        return;
      }
      const clamped = Math.min(pos, view.state.doc.length);
      view.dispatch({
        selection: EditorSelection.cursor(clamped),
        effects: EditorView.scrollIntoView(clamped, { y: "start", yMargin: 16 }),
      });
      view.focus();
    },
    [isReadMode, offsetBySlug, previewRef, viewRef],
  );

  return (
    <DocumentOutline
      headings={headings}
      activeSlug={isReadMode ? domActiveSlug : cmActiveSlug}
      onSelect={handleSelect}
    />
  );
}
