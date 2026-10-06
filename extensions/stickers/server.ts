import "server-only";

import { z } from "zod";

import { defineServer } from "@/lib/extension-api/server";

import manifest from "./manifest";
import {
  STICKER_MAX_SIZE,
  STICKER_MIN_SIZE,
  stickersStateSchema,
  type PublicStickerItem,
  type StickerItem,
} from "./state";

const addStickerInputSchema = z.object({
  assetId: z
    .string()
    .uuid()
    .describe("An image asset the user owns (from search_assets)."),
  left: z
    .number()
    .default(80)
    .describe("Horizontal position in document-layer pixels."),
  top: z
    .number()
    .default(240)
    .describe("Vertical position in document-layer pixels."),
  width: z
    .number()
    .min(STICKER_MIN_SIZE)
    .max(STICKER_MAX_SIZE)
    .default(120)
    .describe("Sticker size in pixels (square)."),
  rotation: z.number().default(0).describe("Clockwise rotation in degrees."),
});

const addStickerOutputSchema = z.object({
  stickerId: z.string().describe("Id of the placed sticker."),
});

const removeStickerInputSchema = z.object({
  stickerId: z
    .string()
    .min(1)
    .describe("The sticker id to remove (from vault.stickers.list)."),
});

export default defineServer(manifest, {
  // Public pages show a read-only sticker layer, limited to stickers whose
  // image is itself public: publishing a document never publishes its
  // assets. (Workspace readers read the layout from state directly.)
  loadRenderData: async (context) => {
    if (context.surface !== "public") return null;

    const parsed = stickersStateSchema.safeParse(context.state.layout?.state);
    if (!parsed.success) return { items: [] };

    const stickers: PublicStickerItem[] = Object.entries(parsed.data.items).map(
      ([id, item]) => ({ id, ...item }),
    );
    const visible = new Set(
      await context.assets.filterPublic(stickers.map((sticker) => sticker.assetId)),
    );
    return { items: stickers.filter((sticker) => visible.has(sticker.assetId)) };
  },
  state: [{ key: "layout", version: 1, schema: stickersStateSchema }],
  actions: [
    {
      id: "vault.stickers.listStickers",
      title: "List stickers",
      description:
        "List the asset-backed stickers placed on a document, with each sticker's id, asset, position, size, and rotation.",
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      input: z.object({}),
      async handler(_input, context) {
        const document = context.document;
        if (!document) {
          throw new Error("This action requires a document.");
        }

        const raw = await document.state.get("layout");
        if (!raw) {
          return { data: { stickers: [] }, message: "No stickers." };
        }
        const state = stickersStateSchema.parse(raw);
        const stickers = Object.entries(state.items).map(([id, item]) => ({
          id,
          ...item,
        }));
        return {
          data: { stickers },
          message: `${stickers.length} sticker${stickers.length === 1 ? "" : "s"}.`,
        };
      },
    },
    {
      id: "vault.stickers.addSticker",
      title: "Add a sticker",
      description:
        "Place an image asset the user owns as a sticker on a document at an optional position/size/rotation. Find asset ids with search_assets.",
      scope: "document",
      mutates: true,
      permissions: ["document:write-extension-state", "asset:read"],
      input: addStickerInputSchema,
      output: addStickerOutputSchema,
      async handler(input, context) {
        const document = context.document;
        if (!document?.assets) {
          throw new Error("This action requires a document and asset access.");
        }

        const args = input as z.infer<typeof addStickerInputSchema>;
        const asset = await document.assets.get(args.assetId);
        if (!asset) {
          throw new Error("Asset not found, not ready, or not owned by you.");
        }
        if (asset.kind !== "image") {
          throw new Error("Only image assets can be used as stickers.");
        }

        const existing = (await document.state.list()).find(
          (row) => row.stateKey === "layout",
        );
        const current = existing
          ? stickersStateSchema.parse(existing.state)
          : stickersStateSchema.parse({});

        const id = `s_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const item: StickerItem = {
          assetId: args.assetId,
          left: args.left,
          top: args.top,
          width: args.width,
          rotation: args.rotation,
        };

        const next = stickersStateSchema.parse({
          items: { ...current.items, [id]: item },
        });

        // The interactive layer persists the layout as `public` so stickers
        // render on published pages; preserve an existing visibility, else match.
        await document.state.set(next, {
          stateKey: "layout",
          version: 1,
          visibility: existing?.visibility ?? "public",
        });

        return {
          data: { stickerId: id },
          message: `Added sticker "${asset.displayName}" to the document.`,
        };
      },
    },
    {
      id: "vault.stickers.removeSticker",
      title: "Remove a sticker",
      description:
        "Remove a sticker from a document by its id (from listStickers).",
      scope: "document",
      mutates: true,
      permissions: ["document:write-extension-state"],
      input: removeStickerInputSchema,
      async handler(input, context) {
        const document = context.document;
        if (!document) {
          throw new Error("This action requires a document.");
        }

        const { stickerId } = input as z.infer<typeof removeStickerInputSchema>;
        const existing = (await document.state.list()).find(
          (row) => row.stateKey === "layout",
        );
        if (!existing) {
          return { message: "This document has no stickers." };
        }

        const current = stickersStateSchema.parse(existing.state);
        if (!current.items[stickerId]) {
          return { message: `No sticker "${stickerId}" on this document.` };
        }

        const rest = { ...current.items };
        delete rest[stickerId];
        const next = stickersStateSchema.parse({ items: rest });
        await document.state.set(next, {
          stateKey: "layout",
          version: 1,
          visibility: existing.visibility,
        });

        return {
          data: { removed: stickerId },
          message: `Removed sticker "${stickerId}".`,
        };
      },
    },
  ],
});
