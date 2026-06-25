import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { assets, documentExtensionStates } from "@/db/schema";
import { stickersStateSchema, type StickerItem } from "@/lib/extensions/catalog";

export type PublicStickerItem = StickerItem & { id: string };

export async function getPublicStickerItems(
  documentId: string,
): Promise<PublicStickerItem[]> {
  const row = await db.query.documentExtensionStates.findFirst({
    where: and(
      eq(documentExtensionStates.documentId, documentId),
      eq(documentExtensionStates.extensionId, "vault.stickers"),
      eq(documentExtensionStates.stateKey, "layout"),
      eq(documentExtensionStates.visibility, "public"),
      isNull(documentExtensionStates.deletedAt),
    ),
  });

  if (!row?.state) return [];

  const parsed = stickersStateSchema.safeParse(row.state);
  if (!parsed.success) return [];

  const stickers = Object.entries(parsed.data.items).map(([id, item]) => ({
    id,
    ...item,
  }));
  if (stickers.length === 0) return [];

  const assetIds = stickers.map((s) => s.assetId);
  const publicAssets = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(inArray(assets.id, assetIds), eq(assets.visibility, "public")));

  const publicAssetIdSet = new Set(publicAssets.map((a) => a.id));
  return stickers.filter((s) => publicAssetIdSet.has(s.assetId));
}
