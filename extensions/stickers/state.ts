import { z } from "zod";

const stickerItemSchema = z.object({
  assetId: z.string(),
  left: z.number(),
  top: z.number(),
  width: z.number().default(120),
  rotation: z.number().default(0),
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
