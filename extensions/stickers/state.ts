import { z } from "zod";

import { overlayAnchorSchema } from "@/lib/extension-api";

const stickerItemSchema = z.object({
  assetId: z.string(),
  left: z.number(),
  top: z.number(),
  width: z.number().default(120),
  rotation: z.number().default(0),
  /**
   * The text line the sticker sits beside (`useOverlayAnchors`), so it lands
   * beside the same words in the editor and on read/public pages. `top` stays
   * as the fallback (and the position from before anchoring existed).
   */
  anchor: overlayAnchorSchema.optional(),
});

export const stickersStateSchema = z.object({
  items: z.record(z.string(), stickerItemSchema).default({}),
});

export type StickerItem = z.infer<typeof stickerItemSchema>;
export type StickersState = z.infer<typeof stickersStateSchema>;
export type PublicStickerItem = StickerItem & { id: string };

/** Sticker size bounds, mirrored from the interactive layer (StickerLayer.tsx). */
export const STICKER_MIN_SIZE = 40;
export const STICKER_MAX_SIZE = 500;
