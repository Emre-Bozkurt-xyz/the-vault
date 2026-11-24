"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { createPageAnchorSurface } from "@/components/extensions/page-anchor-surface";
import type { OverlayAnchorSurface } from "@/lib/extension-api/anchors";
import { cn } from "@/lib/utils";

type DocumentOverlayHostProps = {
  documentId: string;
  children: ReactNode;
  overlays?: ReactNode;
  className?: string;
  /**
   * Where the document's lines are laid out, for overlay items anchored to
   * text (`useOverlayAnchors`). The editor passes its own; otherwise, given
   * the document's `markdown`, the host finds lines in its rendered content.
   */
  anchorSurface?: OverlayAnchorSurface | null;
  markdown?: string;
};

type OverlayAnchorContextValue = {
  surface: OverlayAnchorSurface | null;
  /** The overlay layer: items are positioned in its coordinates. */
  layer: HTMLElement | null;
};

const OverlayAnchorContext = createContext<OverlayAnchorContextValue>({ surface: null, layer: null });

/** The anchor surface and overlay layer around an overlay (`useOverlayAnchors`). */
export function useOverlayAnchorContext(): OverlayAnchorContextValue {
  return useContext(OverlayAnchorContext);
}

export function DocumentOverlayHost({
  documentId,
  children,
  overlays,
  className,
  anchorSurface,
  markdown,
}: DocumentOverlayHostProps) {
  // Elements held in state (callback refs), so the surface and context update
  // when they mount.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);

  const pageSurface = useMemo(
    () =>
      !anchorSurface && host && content && markdown !== undefined
        ? createPageAnchorSurface(content, host, markdown)
        : null,
    [anchorSurface, content, host, markdown],
  );
  const surface = anchorSurface ?? pageSurface;
  const anchors = useMemo(() => ({ surface, layer }), [layer, surface]);

  return (
    <div
      ref={setHost}
      className={cn("vault-document-overlay-host", className)}
      data-document-id={documentId}
    >
      <div ref={setContent} className="vault-document-overlay-content">{children}</div>
      <div
        ref={setLayer}
        className="vault-document-overlay-layer"
        aria-hidden={overlays ? undefined : true}
      >
        <OverlayAnchorContext.Provider value={anchors}>{overlays}</OverlayAnchorContext.Provider>
      </div>
    </div>
  );
}

export function DocumentOverlayItem({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("vault-document-overlay-item", className)} style={style}>
      {children}
    </div>
  );
}
