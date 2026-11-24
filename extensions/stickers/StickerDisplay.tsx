"use client";

import type { OverlayProps } from "@/lib/extension-api";
import {
  OverlayItem,
  useExtensionState,
  useOverlayAnchors,
  useRevealRequest,
} from "@/lib/extension-api/react";

import { revealSticker } from "./reveal";
import { stickersStateSchema, type PublicStickerItem } from "./state";

/**
 * The read-only sticker layer every reader sees, whether or not they enabled
 * stickers (`docs/23_EXTENSION_SDK_PLAN.md` §16 decision 1).
 *
 * In the workspace the reader can read the document, so its layout comes
 * straight from extension state (prefetched with the page). On a public page
 * it comes from the server's `loadRenderData`, which alone can check that
 * each sticker's image is itself public.
 */
export default function StickerDisplay({ ctx }: OverlayProps) {
  const fromState = ctx.surface === "workspace";
  const { value, status } = useExtensionState(ctx, fromState ? "layout" : null, {
    schema: stickersStateSchema,
  });
  // Beside the line of text each sticker was anchored to (StickerLayer).
  const anchors = useOverlayAnchors();
  // "Used in … · Stickers" links land here for readers who don't edit.
  useRevealRequest(ctx, revealSticker, !fromState || status !== "loading");

  const items: PublicStickerItem[] = fromState
    ? Object.entries(value?.items ?? {}).map(([id, item]) => ({ id, ...item }))
    : ((ctx.data as { items?: PublicStickerItem[] } | null)?.items ?? []);

  return (
    <>
      {items.map((item) => (
        <OverlayItem
          key={item.id}
          interactive={false}
          style={{
            left: item.left,
            top: (item.anchor ? anchors.resolve(item.anchor) : null) ?? item.top,
            width: item.width,
          }}
        >
          <div
            data-sticker-id={item.id}
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
              style={{ width: item.width, height: item.width }}
              className="block rounded-sm object-cover"
              loading="lazy"
            />
          </div>
        </OverlayItem>
      ))}
    </>
  );
}
