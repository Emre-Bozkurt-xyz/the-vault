"use client";

import type { ReactNode } from "react";

import type { PublicStickerItem } from "@/server/sticker-state";

type Props = {
  children: ReactNode;
  items: PublicStickerItem[];
};

export function PublicStickerDisplay({ children, items }: Props) {
  return (
    // isolation: isolate + position: relative mirrors the editor's overlay-host
    // so stickers (z-index: 6) render above markdown content (z-index: 1).
    <div style={{ position: "relative", isolation: "isolate" }}>
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      {items.length > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                position: "absolute",
                left: item.left,
                top: item.top,
                width: item.width,
              }}
            >
              <div
                style={{
                  transform: `rotate(${item.rotation ?? 0}deg)`,
                  transformOrigin: "center center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/assets/${item.assetId}/content`}
                  alt=""
                  draggable={false}
                  style={{
                    display: "block",
                    width: item.width,
                    height: item.width,
                  }}
                  className="rounded-sm object-cover"
                  loading="eager"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
