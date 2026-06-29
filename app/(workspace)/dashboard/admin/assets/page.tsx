import Link from "next/link";
import {
  Database,
  FileText,
  HardDrive,
  ImageIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { MetricCard, UsageBar } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteAssetAsAdminAction,
  getAssetStorageOverview,
  listAssetsForUserAdmin,
  listUserStorageForAdmin,
  recalcUserStorageAction,
  updateUserQuotaAction,
  type AdminAssetItem,
} from "@/server/assets-admin";
import { requireAdmin } from "@/server/authz";

const MB = 1024 * 1024;
const MIN_OPTIONS = [
  { label: "Any usage", value: "0" },
  { label: "> 1 MB", value: "1" },
  { label: "> 10 MB", value: "10" },
  { label: "> 50 MB", value: "50" },
  { label: "> 100 MB", value: "100" },
];
const SORT_OPTIONS = [
  { label: "Usage (high to low)", value: "usage_desc" },
  { label: "Usage (low to high)", value: "usage_asc" },
  { label: "Quota (high to low)", value: "quota_desc" },
  { label: "Asset count", value: "assets_desc" },
  { label: "Name (A to Z)", value: "name_asc" },
];

export default async function AdminAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    min?: string;
    userId?: string;
  }>;
}) {
  await requireAdmin();
  const { q, sort, min, userId } = await searchParams;
  const minMb = Number(min) > 0 ? Number(min) : 0;

  const [overview, userRows, selectedAssets] = await Promise.all([
    getAssetStorageOverview(),
    listUserStorageForAdmin({
      query: q,
      sort,
      minBytes: minMb * MB,
    }),
    userId ? listAssetsForUserAdmin(userId) : Promise.resolve([]),
  ]);

  const overallRatio =
    overview.totalQuotaBytes > 0
      ? overview.trackedUsedBytes / overview.totalQuotaBytes
      : 0;

  function userHref(targetUserId?: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort) params.set("sort", sort);
    if (min && minMb > 0) params.set("min", min);
    if (targetUserId) params.set("userId", targetUserId);
    const queryString = params.toString();
    return queryString
      ? `/dashboard/admin/assets?${queryString}`
      : "/dashboard/admin/assets";
  }

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "admin",
          title: "Assets",
          href: "/dashboard/admin/assets",
        }}
      />
      <AdminShell>
      <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex items-center gap-2">
            <HardDrive className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Overview</h2>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={<Database className="size-4" />}
              label="Stored"
              value={formatBytes(overview.totalBytes)}
              hint={`${formatBytes(overview.trackedUsedBytes)} tracked across users`}
            />
            <MetricCard
              icon={<FileText className="size-4" />}
              label="Assets"
              value={overview.totalAssets.toLocaleString()}
              hint={`${overview.imageCount} images - ${overview.pdfCount} PDFs`}
            />
            <MetricCard
              icon={<ImageIcon className="size-4" />}
              label="Public"
              value={overview.publicCount.toLocaleString()}
              hint={`${overview.privateCount} private`}
            />
            <MetricCard
              icon={<Users className="size-4" />}
              label="Users with uploads"
              value={overview.usersWithAssets.toLocaleString()}
              hint={`of ${overview.userCount} total`}
            />
          </div>

          <div className="grid gap-1.5 border border-border/60 bg-background/45 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-[0.16em]">
                Total quota usage
              </span>
              <span>{Math.round(overallRatio * 100)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  overallRatio >= 0.9 ? "bg-destructive" : "bg-primary",
                )}
                style={{
                  width: `${Math.max(
                    Math.min(overallRatio, 1) * 100,
                    overview.trackedUsedBytes > 0 ? 1 : 0,
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatBytes(overview.trackedUsedBytes)} of{" "}
              {formatBytes(overview.totalQuotaBytes)} allocated
            </p>
          </div>
        </section>

        <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Per-user usage</h2>
          </div>

          <form className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search name, username, email"
                autoComplete="off"
                className="h-10 pl-9"
              />
            </label>
            <select
              name="sort"
              defaultValue={sort ?? "usage_desc"}
              className="h-10 border border-input bg-background px-3 text-sm"
              aria-label="Sort users"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              name="min"
              defaultValue={min ?? "0"}
              className="h-10 border border-input bg-background px-3 text-sm"
              aria-label="Minimum usage"
            >
              {MIN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>

          {userRows.length === 0 ? (
            <div className="border border-dashed border-border/70 bg-background/45 p-8 text-center">
              <p className="font-semibold">No users match</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Clear the search or lower the minimum usage filter.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {userRows.map((user) => {
                const isOpen = user.id === userId;
                const drift = user.storageUsedBytes !== user.actualBytes;

                return (
                  <article
                    key={user.id}
                    className="grid gap-3 border border-border/60 bg-background/45 p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold">
                            {user.name ?? user.email ?? "Unnamed user"}
                          </h3>
                          {user.username ? (
                            <Badge variant="outline">@{user.username}</Badge>
                          ) : null}
                          <Badge variant="secondary">
                            {user.assetCount} assets
                          </Badge>
                          {drift ? (
                            <Badge variant="destructive">
                              drift: {formatBytes(user.actualBytes)} actual
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {user.email ?? "No email"}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={isOpen ? userHref() : userHref(user.id)}
                          scroll={false}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "gap-2",
                          )}
                        >
                          <SlidersHorizontal className="size-4" />
                          {isOpen ? "Hide assets" : "Manage assets"}
                        </Link>
                        <form action={recalcUserStorageAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <Button type="submit" variant="outline" size="sm">
                            <RefreshCw className="size-4" />
                            Recalc
                          </Button>
                        </form>
                      </div>
                    </div>

                    <UsageBar
                      used={user.storageUsedBytes}
                      quota={user.storageQuotaBytes}
                    />

                    <form
                      action={updateUserQuotaAction}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="userId" value={user.id} />
                      <label className="text-xs font-medium text-muted-foreground">
                        Quota (MiB)
                      </label>
                      <Input
                        type="number"
                        name="quotaMb"
                        min={0}
                        step={1}
                        defaultValue={Math.round(user.storageQuotaBytes / MB)}
                        className="h-9 w-28"
                        aria-label="Storage quota in MiB"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Set quota
                      </Button>
                    </form>

                    {isOpen ? (
                      <AssetModerationList
                        assets={selectedAssets}
                        deleteAction={deleteAssetAsAdminAction}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </AdminShell>
    </>
  );
}

function AssetModerationList({
  assets,
  deleteAction,
}: {
  assets: AdminAssetItem[];
  deleteAction: (formData: FormData) => void;
}) {
  if (assets.length === 0) {
    return (
      <p className="border border-dashed border-border/60 bg-card/45 px-3 py-4 text-sm text-muted-foreground">
        This user has no stored assets.
      </p>
    );
  }

  return (
    <div className="grid gap-2 border-t border-border/60 pt-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="flex flex-wrap items-center justify-between gap-3 border border-border/60 bg-card/45 px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            {asset.kind === "image" ? (
              <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            <a
              href={asset.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium hover:underline"
            >
              {asset.displayName}
            </a>
            <Badge variant={asset.visibility === "public" ? "secondary" : "outline"}>
              {asset.visibility}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {asset.mimeType} - {formatBytes(asset.sizeBytes)}
            </span>
            <form action={deleteAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-4" />
                Delete
              </Button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
