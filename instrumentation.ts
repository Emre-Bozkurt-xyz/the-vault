/**
 * Next.js calls `register` once per server process at startup. Background
 * jobs that are not tied to a request start here; Node-only, so the Edge
 * runtime (the proxy) never loads them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAssetMaintenanceSchedule } = await import(
      "@/server/asset-maintenance-scheduler"
    );
    startAssetMaintenanceSchedule();
  }
}
