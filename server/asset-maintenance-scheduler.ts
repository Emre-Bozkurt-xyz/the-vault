import "server-only";

import { runAssetMaintenance } from "@/server/asset-maintenance";

const FIRST_CHECK_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

declare global {
  var __vaultAssetMaintenanceScheduled: boolean | undefined;
}

/**
 * Whether this server runs the cleanup on its own: production only, and only
 * with R2 configured, since a dev server pointed at a shared bucket must never
 * start deleting objects by itself. `ASSET_MAINTENANCE=off` disables it.
 */
export function isAssetMaintenanceScheduled() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.ASSET_MAINTENANCE !== "off" &&
    Boolean(process.env.R2_BUCKET && process.env.R2_ENDPOINT)
  );
}

/**
 * Started once per server process from `instrumentation.ts`. Checks hourly;
 * `runAssetMaintenance` itself decides whether a run is due (~daily) and holds
 * a lease, so restarts and multiple processes do not multiply runs.
 */
export function startAssetMaintenanceSchedule() {
  if (globalThis.__vaultAssetMaintenanceScheduled) return;

  if (!isAssetMaintenanceScheduled()) return;

  globalThis.__vaultAssetMaintenanceScheduled = true;

  const check = () => {
    void runAssetMaintenance({ trigger: "schedule" })
      .then((result) => {
        if (result) {
          console.info("[asset-maintenance] scheduled run", result);
        }
      })
      .catch((error) => console.error("[asset-maintenance] scheduled check failed", error));
  };

  setTimeout(() => {
    check();
    setInterval(check, CHECK_EVERY_MS).unref?.();
  }, FIRST_CHECK_MS).unref?.();
}
