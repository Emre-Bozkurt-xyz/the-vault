import { Play, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AssetMaintenanceResult } from "@/lib/asset-maintenance";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import { runAssetMaintenanceAction } from "@/server/assets-admin";

export function AssetMaintenancePanel({
  ranAt,
  startedAt,
  result,
  scheduled,
}: {
  ranAt: Date | null;
  startedAt: Date | null;
  result: AssetMaintenanceResult | null;
  /** Whether this process runs it daily (production with R2 configured). */
  scheduled: boolean;
}) {
  const running = startedAt !== null;

  return (
    <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Storage cleanup</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Deleting an asset removes its file from storage right away. This
            cleanup catches what that can miss: files whose delete failed, files of
            deleted accounts, and uploads that died halfway. It also permanently
            removes records of assets deleted more than{" "}
            {ASSET_LIMITS.deletedAssetRetentionDays} days ago.{" "}
            {scheduled ? "It runs once a day." : "Automatic runs are off on this server."}
          </p>
        </div>
        <form action={runAssetMaintenanceAction}>
          <Button type="submit" variant="outline" size="sm" disabled={running}>
            <Play data-icon="inline-start" />
            {running ? "Running…" : "Run now"}
          </Button>
        </form>
      </div>

      {result && ranAt ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Last run {ranAt.toLocaleString()} ({result.trigger === "manual" ? "manual" : "scheduled"},{" "}
            {(result.durationMs / 1000).toFixed(1)}s)
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Records purged" value={result.purgedRows} />
            <Stat label="Files checked" value={result.scannedObjects} />
            <Stat label="Orphans removed" value={result.deletedObjects} />
            <Stat
              label="Failed deletes"
              value={result.failedDeletes}
              tone={result.failedDeletes > 0 ? "warn" : undefined}
            />
          </dl>
          {result.error ? (
            <p className="text-xs text-destructive">Stopped early: {result.error}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Not run yet.</p>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="border border-border/60 bg-background/45 px-3 py-2">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className={tone === "warn" ? "mt-1 text-lg font-semibold text-destructive" : "mt-1 text-lg font-semibold"}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
