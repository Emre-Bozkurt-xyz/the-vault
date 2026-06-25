"use server";

import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { assets, type AssetKind } from "@/db/schema";
import { requireActiveUser } from "@/server/authz";

export type PickerAsset = {
  id: string;
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

  return db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(limit);
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

  return db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.publishedAt), desc(assets.createdAt))
    .limit(limit);
}
