"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

type DocumentOverlayHostProps = {
  documentId: string;
  children: ReactNode;
  overlays?: ReactNode;
  className?: string;
};

export function DocumentOverlayHost({
  documentId,
  children,
  overlays,
  className,
}: DocumentOverlayHostProps) {
  return (
    <div
      className={cn("vault-document-overlay-host", className)}
      data-document-id={documentId}
    >
      <div className="vault-document-overlay-content">{children}</div>
      <div
        className="vault-document-overlay-layer"
        aria-hidden={overlays ? undefined : true}
      >
        {overlays}
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
