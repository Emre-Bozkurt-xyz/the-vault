"use server";

import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { assets, type AssetKind } from "@/db/schema";
import { buildAssetRenditionUrls } from "@/server/assets";
import { requireActiveUser } from "@/server/authz";

export type PickerAsset = {
  id: string;
  /** Grid thumbnail, or null when the asset has none (not an image, or it failed). */
  thumbUrl: string | null;
  kind: AssetKind;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export async function listUserAssetsForPickerAction(input: {
  kinds?: AssetKind[];
  query?: string;
  limit?: number;
}): Promise<PickerAsset[]> {
  const user = await requireActiveUser();
  const { kinds, query, limit = 100 } = input;

  const conditions = [
    eq(assets.ownerId, user.id),
    eq(assets.status, "ready"),
    isNull(assets.deletedAt),
  ];

  if (kinds && kinds.length > 0) {
    conditions.push(inArray(assets.kind, kinds));
  }

  const trimmed = query?.trim();
  if (trimmed) {
    const pattern = `%${trimmed.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(assets.displayName, pattern),
        ilike(assets.description, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(limit);

  return rows.map(toPickerAsset);
}

export async function listPublicAssetsForPickerAction(input: {
  kinds?: AssetKind[];
  query?: string;
  limit?: number;
}): Promise<PickerAsset[]> {
  const { kinds, query, limit = 80 } = input;

  const conditions = [
    eq(assets.visibility, "public"),
    eq(assets.status, "ready"),
    isNull(assets.deletedAt),
  ];

  if (kinds && kinds.length > 0) {
    conditions.push(inArray(assets.kind, kinds));
  }

  const trimmed = query?.trim();
  if (trimmed) {
    const pattern = `%${trimmed.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(assets.displayName, pattern),
        ilike(assets.description, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.publishedAt), desc(assets.createdAt))
    .limit(limit);

  return rows.map(toPickerAsset);
}

function toPickerAsset(row: {
  id: string;
  kind: AssetKind;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  renditionStatus: "none" | "ready" | "failed";
  renditionVersion: number | null;
}): PickerAsset {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    thumbUrl: buildAssetRenditionUrls(row).thumbUrl,
  };
}
