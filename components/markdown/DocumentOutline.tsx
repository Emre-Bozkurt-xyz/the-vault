"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { List, PanelRightClose, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type OutlineHeading = {
  level: number;
  text: string;
  slug: string;
};

const collapsedStorageKey = "vault.outline.collapsed";
const collapsedChangeEvent = "vault:outline-collapsed-change";

/** Gap (px) kept between the rail and the left edge of the document column. */
const outlineRailGap = 20;
/**
 * Breathing room (px) kept on the rail's other side, so it does not sit flush
 * against the workspace side panel. Yields before the rail does: it is given up
 * as the gutter tightens, rather than costing a layout its rail.
 */
const outlineRailInset = 16;
/** Widest the rail ever gets; it shrinks to fit a narrower gutter. */
const outlineRailMaxWidth = 192;
/** Narrower than this the rail is unreadable, so the drawer is used instead. */
const outlineRailMinWidth = 132;

/**
 * Nearest scrolling ancestor, so the gutter is measured inside the actual
 * content area (e.g. the workspace `<main>` right of the side panels) rather
 * than against the raw viewport. `null` means the window is the scroller.
 */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflowX}`)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Width (px) of the left gutter of the content block (the sentinel's parent) —
 * the empty margin the rail is allowed to overlay. `null` until measured
 * (SSR / first paint).
 *
 * The gutter changes whenever the content block *moves* rather than resizes: a
 * workspace side panel opening shifts a max-width-capped column sideways without
 * changing its size. So the scroll parent is observed alongside the block
 * itself; observing only the block leaves a stale measurement behind, which is
 * why live and read mode used to disagree about the same layout (live
 * re-measured on every keystroke-driven reflow, read never re-measured at all).
 */
function useOutlineGutter(
  enabled: boolean,
): [number | null, RefObject<HTMLSpanElement | null>] {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [gutter, setGutter] = useState<number | null>(null);

  useEffect(() => {
    const parent = sentinelRef.current?.parentElement;
    if (!enabled || !parent) {
      return;
    }
    const scrollParent = findScrollParent(parent);
    const measure = () => {
      const origin = scrollParent
        ? scrollParent.getBoundingClientRect().left
        : 0;
      setGutter(parent.getBoundingClientRect().left - origin);
    };
    // ResizeObserver fires an initial async callback on observe(), so the first
    // measurement happens off the effect body (no synchronous setState).
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(document.documentElement);
    if (scrollParent) {
      observer.observe(scrollParent);
    }
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);

  return [gutter, sentinelRef];
}

/**
 * Collapsed preference backed by localStorage, read via useSyncExternalStore so
 * SSR renders the default (expanded) and the client reconciles without an
 * effect-driven setState or hydration mismatch. Multiple outline instances stay
 * in sync via a same-window custom event plus the cross-tab `storage` event.
 */
function useOutlineCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(collapsedChangeEvent, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(collapsedChangeEvent, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => window.localStorage.getItem(collapsedStorageKey) === "true",
    () => false,
  );

  const toggle = useCallback(() => {
    const next = !(
      window.localStorage.getItem(collapsedStorageKey) === "true"
    );
    try {
      window.localStorage.setItem(collapsedStorageKey, String(next));
    } catch {
      // Ignore storage failures (private mode, quota).
    }
    window.dispatchEvent(new Event(collapsedChangeEvent));
  }, []);

  return [collapsed, toggle];
}

type DocumentOutlineProps = {
  headings: OutlineHeading[];
  activeSlug: string | null;
  onSelect: (heading: OutlineHeading) => void;
  /** CSS length for the sticky rail's `top` (accounts for a sticky toolbar). */
  stickyTop?: string;
  className?: string;
};

/**
 * Minimal, hierarchical document outline. Presentational: the parent supplies
 * `headings`, the current `activeSlug`, and an `onSelect` that performs the
 * surface-specific navigation (anchor scroll for rendered docs, scroll-to-line
 * for the CodeMirror editor).
 *
 * Renders a sticky rail in the document's left gutter, sized to whatever gutter
 * the surface actually has, identically for every mode and surface. When the
 * gutter is too narrow for a readable rail it degrades to an in-flow toggle plus
 * an overlay drawer — in flow rather than floating, so it can never land on top
 * of the workspace shell's fixed corner buttons. The rail collapses to a reopen
 * button in the same spot as the collapse button; that preference is stored in
 * localStorage. Renders nothing when there are fewer than two headings.
 */
export function DocumentOutline({
  headings,
  activeSlug,
  onSelect,
  stickyTop = "1.5rem",
  className,
}: DocumentOutlineProps) {
  const [collapsed, toggleCollapsed] = useOutlineCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const enabled = headings.length >= 2;
  const [gutter, sentinelRef] = useOutlineGutter(enabled);

  if (!enabled) {
    return null;
  }

  // Space left of the document column the rail may occupy. The inset comes out
  // of the rail's width, but never at the cost of dropping below the readable
  // minimum — so the set of layouts that get a rail is unchanged.
  const available = gutter == null ? null : gutter - outlineRailGap;
  const hasRail = available != null && available >= outlineRailMinWidth;
  const railWidth = hasRail
    ? Math.min(
        outlineRailMaxWidth,
        Math.max(available - outlineRailInset, outlineRailMinWidth),
      )
    : null;
  // `null` while unmeasured, so neither affordance flashes before first paint.
  const hasDrawer = gutter != null && !hasRail;

  const minLevel = headings.reduce(
    (min, heading) => Math.min(min, heading.level),
    6,
  );

  const handleSelect = (heading: OutlineHeading) => {
    onSelect(heading);
    setDrawerOpen(false);
  };

  const list = (
    <ul className="vault-outline-list">
      {headings.map((heading) => {
        const isActive = heading.slug === activeSlug;
        return (
          <li key={heading.slug}>
            <button
              type="button"
              onClick={() => handleSelect(heading)}
              aria-current={isActive ? "location" : undefined}
              className={cn(
                "vault-outline-item",
                isActive && "vault-outline-item-active",
              )}
              style={{
                paddingInlineStart: `${(heading.level - minLevel) * 0.75 + 0.25}rem`,
              }}
              title={heading.text}
            >
              <span className="vault-outline-item-text">{heading.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {/* Always present so the gutter can be measured; renders nothing visible. */}
      <span ref={sentinelRef} hidden aria-hidden="true" />

      {/* Enough gutter → rail overlaying the left margin (never displaces content) */}
      {railWidth != null ? (
        <div
          className="vault-outline-anchor"
          style={{ width: railWidth, marginRight: outlineRailGap }}
        >
          <nav
            aria-label="Document outline"
            className={cn("vault-outline", className)}
            style={{ top: stickyTop }}
            data-collapsed={collapsed ? "true" : undefined}
          >
            {collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="vault-outline-reopen"
                title="Show outline"
                aria-label="Show outline"
              >
                <List className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <div className="vault-outline-panel">
                <div className="vault-outline-header">
                  <span className="vault-outline-heading">On this page</span>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    className="vault-outline-collapse"
                    title="Hide outline"
                    aria-label="Hide outline"
                  >
                    {/* Mirrored: the rail collapses rightwards, onto this spot. */}
                    <PanelRightClose className="size-4" aria-hidden="true" />
                  </button>
                </div>
                {list}
              </div>
            )}
          </nav>
        </div>
      ) : null}

      {/* Not enough gutter (narrow / panels open) → toggle + overlay drawer */}
      {hasDrawer ? (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="vault-outline-inline-toggle"
        >
          <List className="size-4" aria-hidden="true" />
          <span>On this page</span>
        </button>
      ) : null}

      {hasDrawer && drawerOpen ? (
        <div className="vault-outline-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="vault-outline-overlay-backdrop"
            aria-label="Close outline"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="vault-outline-overlay-panel">
            <div className="vault-outline-header">
              <span className="vault-outline-heading">On this page</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="vault-outline-collapse"
                aria-label="Close outline"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {list}
          </div>
        </div>
      ) : null}
    </>
  );
}
