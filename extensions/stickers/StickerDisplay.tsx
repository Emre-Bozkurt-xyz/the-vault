"use client";

import type { OverlayProps } from "@/lib/extension-api";
import { OverlayItem, useExtensionState } from "@/lib/extension-api/react";

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
  const { value } = useExtensionState(ctx, fromState ? "layout" : null, {
    schema: stickersStateSchema,
  });

  const items: PublicStickerItem[] = fromState
    ? Object.entries(value?.items ?? {}).map(([id, item]) => ({ id, ...item }))
    : ((ctx.data as { items?: PublicStickerItem[] } | null)?.items ?? []);

  return (
    <>
      {items.map((item) => (
        <OverlayItem
          key={item.id}
          interactive={false}
          style={{ left: item.left, top: item.top, width: item.width }}
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
