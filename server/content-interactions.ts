"use server";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  contentLikes,
  contentViews,
  documents,
  type ContentTargetKind,
} from "@/db/schema";

export type ContentStats = {
  likeCount: number;
  viewCount: number;
  viewerHasLiked: boolean;
  score: number;
  trendingScore: number;
};

export type ContentTarget =
  | {
      kind: "document";
      id: string;
    }
  | {
      kind: "asset";
      id: string;
    };

type ViewerIdentity = {
  userId?: string | null;
  anonymousHash?: string | null;
};

export async function getDocumentContentStats(
  documentIds: string[],
  userId?: string | null,
) {
  return getContentStats({ kind: "document", ids: documentIds, userId });
}

export async function getAssetContentStats(
  assetIds: string[],
  userId?: string | null,
) {
  return getContentStats({ kind: "asset", ids: assetIds, userId });
}

export async function toggleContentLike(input: {
  target: ContentTarget;
  userId: string;
}) {
  await assertPublicTarget(input.target);

  const targetWhere = targetPredicate(input.target);
  const [existing] = await db
    .select({ id: contentLikes.id })
    .from(contentLikes)
    .where(and(targetWhere, eq(contentLikes.userId, input.userId)))
    .limit(1);

  if (existing) {
    await db.delete(contentLikes).where(eq(contentLikes.id, existing.id));
  } else {
    await db.insert(contentLikes).values({
      targetKind: input.target.kind,
      documentId: input.target.kind === "document" ? input.target.id : null,
      assetId: input.target.kind === "asset" ? input.target.id : null,
      userId: input.userId,
    });
  }

  const stats = await getContentStats({
    kind: input.target.kind,
    ids: [input.target.id],
    userId: input.userId,
  });

  return {
    liked: !existing,
    stats: stats.get(input.target.id) ?? emptyStats(),
  };
}

export async function recordContentView(input: {
  target: ContentTarget;
  viewer: ViewerIdentity;
}) {
  await assertPublicTarget(input.target);

  const viewDay = new Date().toISOString().slice(0, 10);
  const hasViewer = input.viewer.userId || input.viewer.anonymousHash;

  if (!hasViewer) {
    return null;
  }

  await db
    .insert(contentViews)
    .values({
      targetKind: input.target.kind,
      documentId: input.target.kind === "document" ? input.target.id : null,
      assetId: input.target.kind === "asset" ? input.target.id : null,
      userId: input.viewer.userId ?? null,
      anonymousHash: input.viewer.userId
        ? null
        : input.viewer.anonymousHash?.slice(0, 128) ?? null,
      viewDay,
    })
    .onConflictDoNothing();

  const stats = await getContentStats({
    kind: input.target.kind,
    ids: [input.target.id],
    userId: input.viewer.userId,
  });

  return stats.get(input.target.id) ?? emptyStats();
}

async function getContentStats(input: {
  kind: ContentTargetKind;
  ids: string[];
  userId?: string | null;
}) {
  const ids = [...new Set(input.ids)].filter(Boolean);
  const stats = new Map<string, ContentStats>();

  for (const id of ids) {
    stats.set(id, emptyStats());
  }

  if (ids.length === 0) {
    return stats;
  }

  const targetColumn =
    input.kind === "document" ? contentLikes.documentId : contentLikes.assetId;
  const viewTargetColumn =
    input.kind === "document" ? contentViews.documentId : contentViews.assetId;

  const [likeRows, viewRows, recentLikeRows, recentViewRows, viewerRows] =
    await Promise.all([
    db
      .select({
        id: targetColumn,
        count: sql<number>`count(*)::int`,
      })
      .from(contentLikes)
      .where(
        and(eq(contentLikes.targetKind, input.kind), inArray(targetColumn, ids)),
      )
      .groupBy(targetColumn),
    db
      .select({
        id: viewTargetColumn,
        count: sql<number>`count(*)::int`,
      })
      .from(contentViews)
      .where(
        and(eq(contentViews.targetKind, input.kind), inArray(viewTargetColumn, ids)),
      )
      .groupBy(viewTargetColumn),
    db
      .select({
        id: targetColumn,
        count: sql<number>`count(*)::int`,
      })
      .from(contentLikes)
      .where(
        and(
          eq(contentLikes.targetKind, input.kind),
          inArray(targetColumn, ids),
          sql`${contentLikes.createdAt} >= now() - interval '7 days'`,
        ),
      )
      .groupBy(targetColumn),
    db
      .select({
        id: viewTargetColumn,
        count: sql<number>`count(*)::int`,
      })
      .from(contentViews)
      .where(
        and(
          eq(contentViews.targetKind, input.kind),
          inArray(viewTargetColumn, ids),
          sql`${contentViews.createdAt} >= now() - interval '7 days'`,
        ),
      )
      .groupBy(viewTargetColumn),
    input.userId
      ? db
          .select({ id: targetColumn })
          .from(contentLikes)
          .where(
            and(
              eq(contentLikes.targetKind, input.kind),
              eq(contentLikes.userId, input.userId),
              inArray(targetColumn, ids),
            ),
          )
      : Promise.resolve([]),
  ]);

  for (const row of likeRows) {
    if (!row.id) {
      continue;
    }

    const current = stats.get(row.id) ?? emptyStats();
    current.likeCount = Number(row.count);
    current.score = scoreContent(current);
    stats.set(row.id, current);
  }

  for (const row of viewRows) {
    if (!row.id) {
      continue;
    }

    const current = stats.get(row.id) ?? emptyStats();
    current.viewCount = Number(row.count);
    current.score = scoreContent(current);
    stats.set(row.id, current);
  }

  for (const row of recentLikeRows) {
    if (!row.id) {
      continue;
    }

    const current = stats.get(row.id) ?? emptyStats();
    current.trendingScore += Number(row.count) * 5;
    stats.set(row.id, current);
  }

  for (const row of recentViewRows) {
    if (!row.id) {
      continue;
    }

    const current = stats.get(row.id) ?? emptyStats();
    current.trendingScore += Number(row.count);
    stats.set(row.id, current);
  }

  for (const row of viewerRows) {
    if (!row.id) {
      continue;
    }

    const current = stats.get(row.id) ?? emptyStats();
    current.viewerHasLiked = true;
    stats.set(row.id, current);
  }

  return stats;
}

async function assertPublicTarget(target: ContentTarget) {
  if (target.kind === "document") {
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, target.id),
          eq(documents.visibility, "public"),
          isNotNull(documents.publicSlug),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!document) {
      throw new Error("Public content not found.");
    }

    return;
  }

  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, target.id),
        eq(assets.visibility, "public"),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) {
    throw new Error("Public content not found.");
  }
}

function targetPredicate(target: ContentTarget) {
  return target.kind === "document"
    ? and(
        eq(contentLikes.targetKind, target.kind),
        eq(contentLikes.documentId, target.id),
      )
    : and(
        eq(contentLikes.targetKind, target.kind),
        eq(contentLikes.assetId, target.id),
      );
}

function emptyStats(): ContentStats {
  return {
    likeCount: 0,
    viewCount: 0,
    viewerHasLiked: false,
    score: 0,
    trendingScore: 0,
  };
}

function scoreContent(stats: Pick<ContentStats, "likeCount" | "viewCount">) {
  return stats.likeCount * 4 + stats.viewCount;
}
