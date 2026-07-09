"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { ChevronRight, List, PanelLeftClose, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type OutlineHeading = {
  level: number;
  text: string;
  slug: string;
};

const collapsedStorageKey = "vault.outline.collapsed";
const collapsedChangeEvent = "vault:outline-collapsed-change";

/** Minimum left-gutter (px) needed to seat the rail (12rem + 1.75rem + buffer). */
const outlineGutterNeeded = 224;

/**
 * Left edge (viewport px) of the nearest scrolling ancestor, so the gutter is
 * measured within the actual content area (e.g. the workspace `<main>` right of
 * the side panels) rather than the raw viewport. Falls back to 0 (window).
 */
function findScrollParentLeft(element: HTMLElement): number {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflowX}`)) {
      return node.getBoundingClientRect().left;
    }
    node = node.parentElement;
  }
  return 0;
}

/**
 * Whether the left gutter of the content block (the sentinel's parent) is wide
 * enough to seat the outline rail without overlapping content or the workspace
 * panels. `null` until measured (SSR / first paint). Re-measures on any resize,
 * including side-panel width changes.
 */
function useOutlineGutter(): [boolean | null, RefObject<HTMLSpanElement | null>] {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [hasGutter, setHasGutter] = useState<boolean | null>(null);

  useEffect(() => {
    const parent = sentinelRef.current?.parentElement;
    if (!parent) {
      return;
    }
    const measure = () => {
      const gutter =
        parent.getBoundingClientRect().left - findScrollParentLeft(parent);
      setHasGutter(gutter >= outlineGutterNeeded);
    };
    // ResizeObserver fires an initial async callback on observe(), so the first
    // measurement happens off the effect body (no synchronous setState).
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return [hasGutter, sentinelRef];
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
 * Renders a sticky left rail on `lg+` and a toggle + overlay drawer below `lg`.
 * The rail collapses to a slim reopen button; that preference is stored in
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasGutter, sentinelRef] = useOutlineGutter();

  if (headings.length < 2) {
    return null;
  }

  const minLevel = headings.reduce(
    (min, heading) => Math.min(min, heading.level),
    6,
  );

  const handleSelect = (heading: OutlineHeading) => {
    onSelect(heading);
    setMobileOpen(false);
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
      {hasGutter === true ? (
        <div className="vault-outline-anchor">
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
                    <PanelLeftClose className="size-4" aria-hidden="true" />
                  </button>
                </div>
                {list}
              </div>
            )}
          </nav>
        </div>
      ) : null}

      {/* Not enough gutter (narrow / panels open) → toggle + overlay drawer */}
      {hasGutter === false ? (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="vault-outline-mobile-toggle"
          aria-label="Show document outline"
        >
          <List className="size-4" aria-hidden="true" />
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      ) : null}

      {hasGutter === false && mobileOpen ? (
        <div className="vault-outline-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="vault-outline-overlay-backdrop"
            aria-label="Close outline"
            onClick={() => setMobileOpen(false)}
          />
          <div className="vault-outline-overlay-panel">
            <div className="vault-outline-header">
              <span className="vault-outline-heading">On this page</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
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
