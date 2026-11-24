"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { packMasonry } from "@/lib/media-library";

export type MasonryEntry = {
  key: string;
  /** The card's height in px at a given column width (estimated, not measured). */
  estimate: (columnWidth: number) => number;
  node: ReactNode;
};

/**
 * Masonry in list order: entries are dealt left to right into whichever
 * column is shortest (`packMasonry`), so the list reads across the top and
 * columns end level, unlike CSS columns, which fill top to bottom and leave
 * the last one short. Heights are estimated from stored dimensions, so
 * nothing waits on images loading. Each `node` brings its own bottom margin
 * (`gap` must match it); `fallbackClassName` (CSS columns) is used only until
 * the width is measured: the server render and a hard load's first paint.
 */
export function MasonryGrid({
  entries,
  columnsFor,
  gap,
  fallbackClassName,
}: {
  entries: MasonryEntry[];
  columnsFor: (widthPx: number) => number;
  gap: number;
  fallbackClassName: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The first callback arrives before paint, so client navigations never
    // see the fallback. Rounded so sub-pixel jitter doesn't re-pack.
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width / 8) * 8));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const packed = useMemo(() => {
    if (width === null) return null;
    const columns = Math.max(1, columnsFor(width));
    const columnWidth = (width - gap * (columns - 1)) / columns;
    return packMasonry(
      entries.map((entry) => entry.estimate(columnWidth)),
      columns,
      gap,
    );
  }, [width, entries, columnsFor, gap]);

  return (
    <div ref={ref} className="min-w-0">
      {packed === null ? (
        <div className={fallbackClassName}>
          {entries.map((entry) => (
            <div key={entry.key} className="break-inside-avoid">
              {entry.node}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-start" style={{ gap }}>
          {packed.map((column, index) => (
            <div key={index} className="min-w-0 flex-1">
              {column.map((entryIndex) => (
                <div key={entries[entryIndex].key}>{entries[entryIndex].node}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
