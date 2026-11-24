"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  justifiedGap,
  justifiedMaxPerRow,
  justifiedTargetHeight,
  justifyRows,
} from "@/lib/media-library";

export type JustifiedEntry = {
  key: string;
  /** Width ÷ height the tile is drawn at (`tileAspect`). */
  aspect: number;
  /** Fills its box: the grid sizes it, so it must not set its own size. */
  node: ReactNode;
};

/**
 * A phone-gallery mosaic: rows in list order where every tile keeps its shape
 * and all tiles in a row share one height, each row filling the width
 * exactly (`justifyRows`). Narrow tiles (screenshots, portraits) make tall
 * rows of up to three on a phone; wide ones share shorter rows. Until the
 * width is measured (the server render, a hard load's first paint) a
 * CSS-only approximation stands in: tiles grow in proportion to their shape.
 */
export function JustifiedGrid({ entries }: { entries: JustifiedEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The first callback arrives before paint, so client navigations never
    // see the fallback. Whole pixels, so sub-pixel jitter doesn't re-pack.
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (width === null || width <= 0) return null;
    const gap = justifiedGap(width);
    const rows = justifyRows(
      entries.map((entry) => entry.aspect),
      width,
      justifiedTargetHeight(width),
      gap,
      justifiedMaxPerRow(width),
    );
    return { gap, rows };
  }, [width, entries]);

  if (layout === null) {
    const height = 180;
    return (
      <div ref={ref} className="flex min-w-0 flex-wrap gap-1">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="relative min-w-0 overflow-hidden"
            style={{ flexGrow: entry.aspect, flexBasis: entry.aspect * height, height }}
          >
            {entry.node}
          </div>
        ))}
        {/* Soaks up the last row's slack so it isn't stretched. */}
        <div aria-hidden style={{ flexGrow: 100 }} />
      </div>
    );
  }

  return (
    <div ref={ref} className="grid min-w-0" style={{ rowGap: layout.gap }}>
      {layout.rows.map((row) => (
        <div key={entries[row.start].key} className="flex min-w-0" style={{ height: row.height, columnGap: layout.gap }}>
          {entries.slice(row.start, row.end).map((entry) => (
            <div
              key={entry.key}
              className="relative min-w-0 overflow-hidden"
              // A justified row shares its width by shape (exact, no rounding
              // drift); a short last row keeps each tile at its natural width.
              style={row.justified ? { flex: `${entry.aspect} 1 0px` } : { width: entry.aspect * row.height, flex: "none" }}
            >
              {entry.node}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
