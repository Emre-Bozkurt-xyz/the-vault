"use client";

import { useEffect, useState, type RefObject } from "react";

const headingSelector = [
  "h1[id]",
  "h2[id]",
  "h3[id]",
  "h4[id]",
  "h5[id]",
  "h6[id]",
].join(",");

/**
 * Tracks which heading is currently "active" (nearest the top of the viewport)
 * inside a rendered document, for outline scroll-spy. Works for both
 * window-scrolled surfaces (public/share/guides) and inner scroll containers
 * (the workspace `<main>`), because the observer measures against the viewport.
 *
 * `slugsKey` should change when the set of headings changes (e.g. the joined
 * slug list) so the observer re-attaches after the content re-renders.
 */
export function useHeadingScrollSpy(
  rootRef: RefObject<HTMLElement | null>,
  slugsKey: string,
): string | null {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;

    if (!root || typeof IntersectionObserver === "undefined") {
      return;
    }

    const headings = Array.from(
      root.querySelectorAll<HTMLElement>(headingSelector),
    ).filter((element) => element.id);

    if (headings.length === 0) {
      setActiveSlug(null);
      return;
    }

    // Track visibility per heading and, on each change, pick the topmost heading
    // that is at or above the reading line near the top of the viewport.
    const visible = new Map<string, boolean>();

    const pickActive = () => {
      // Prefer the last heading whose top is at/above ~120px from the viewport
      // top (the one you're "in"); fall back to the first visible one.
      let candidate: string | null = null;

      for (const heading of headings) {
        const top = heading.getBoundingClientRect().top;
        if (top - 120 <= 0) {
          candidate = heading.id;
        } else {
          break;
        }
      }

      if (!candidate) {
        candidate =
          headings.find((heading) => visible.get(heading.id))?.id ??
          headings[0].id;
      }

      setActiveSlug(candidate);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target.id, entry.isIntersecting);
        }
        pickActive();
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 1] },
    );

    for (const heading of headings) {
      observer.observe(heading);
    }

    pickActive();

    return () => observer.disconnect();
  }, [rootRef, slugsKey]);

  return activeSlug;
}
