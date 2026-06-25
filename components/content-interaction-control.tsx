"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ContentInteractionStats = {
  likeCount: number;
  viewCount: number;
  viewerHasLiked: boolean;
  score: number;
  trendingScore: number;
};

type ContentInteractionControlProps = {
  targetKind: "document" | "asset";
  targetId: string;
  initialStats: ContentInteractionStats;
  canLike?: boolean;
  readOnly?: boolean;
  recordView?: boolean;
  compact?: boolean;
  className?: string;
  onStatsChange?: (stats: ContentInteractionStats) => void;
};

export function ContentInteractionControl({
  targetKind,
  targetId,
  initialStats,
  canLike = true,
  readOnly = false,
  recordView = false,
  compact = false,
  className,
  onStatsChange,
}: ContentInteractionControlProps) {
  const [stats, setStats] = useState(initialStats);
  const [pending, setPending] = useState(false);
  const onStatsChangeRef = useRef(onStatsChange);

  useEffect(() => {
    onStatsChangeRef.current = onStatsChange;
  }, [onStatsChange]);

  useEffect(() => {
    setStats(initialStats);
  }, [initialStats]);

  useEffect(() => {
    if (!recordView) {
      return;
    }

    const controller = new AbortController();

    void fetch("/api/content/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetKind, targetId }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { stats?: ContentInteractionStats } | null) => {
        if (payload?.stats) {
          setStats(payload.stats);
          onStatsChangeRef.current?.(payload.stats);
        }
      })
      .catch(() => null);

    return () => controller.abort();
  }, [recordView, targetId, targetKind]);

  async function toggleLike() {
    if (!canLike || pending) {
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/content/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind, targetId }),
      });
      const payload = (await response.json()) as {
        stats?: ContentInteractionStats;
      };

      if (response.ok && payload.stats) {
        setStats(payload.stats);
        onStatsChangeRef.current?.(payload.stats);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        compact ? "gap-1.5" : null,
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <Eye className="size-3.5" />
        {formatCount(stats.viewCount)}
      </span>
      {readOnly ? (
        <span className="inline-flex items-center gap-1">
          <Heart
            className={cn(
              "size-3.5",
              stats.viewerHasLiked ? "fill-current text-foreground" : null,
            )}
          />
          {formatCount(stats.likeCount)}
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={stats.viewerHasLiked ? "secondary" : "outline"}
          disabled={!canLike || pending}
          onClick={toggleLike}
          className={cn(
            "h-7 gap-1.5 px-2 text-xs",
            compact ? "h-6 px-1.5" : null,
          )}
          title={canLike ? "Like" : "Sign in to like"}
        >
          <Heart
            className={cn("size-3.5", stats.viewerHasLiked ? "fill-current" : null)}
          />
          {formatCount(stats.likeCount)}
        </Button>
      )}
    </div>
  );
}

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(value);
}
