import Link from "next/link";
import {
  BookOpen,
  Database,
  FileText,
  Hash,
  HardDrive,
  ImageIcon,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { MetricCard } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAdminUserOverview, listUsersForAdmin } from "@/server/admin";
import { getAssetStorageOverview } from "@/server/assets-admin";
import { requireAdmin } from "@/server/authz";

export default async function AdminOverviewPage() {
  await requireAdmin();

  const [userOverview, storage, recent] = await Promise.all([
    getAdminUserOverview(),
    getAssetStorageOverview(),
    listUsersForAdmin({ sort: "joined_desc", page: 1 }),
  ]);

  const recentUsers = recent.items.slice(0, 6);

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "admin", title: "Admin", href: "/dashboard/admin" }}
      />

      <AdminShell>
      <section className="grid gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Users className="size-4 text-primary" />
          Users
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<Users className="size-4" />}
            label="Total users"
            value={userOverview.totalUsers.toLocaleString()}
            hint={`${userOverview.adminCount} admins`}
          />
          <MetricCard
            icon={<UserPlus className="size-4" />}
            label="New this week"
            value={userOverview.newThisWeek.toLocaleString()}
          />
          <MetricCard
            icon={<ShieldAlert className="size-4" />}
            label="Banned"
            value={userOverview.bannedCount.toLocaleString()}
          />
          <MetricCard
            icon={<ImageIcon className="size-4" />}
            label="Users with uploads"
            value={storage.usersWithAssets.toLocaleString()}
            hint={`of ${storage.userCount} total`}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <HardDrive className="size-4 text-primary" />
          Storage &amp; content
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<Database className="size-4" />}
            label="Stored"
            value={formatBytes(storage.totalBytes)}
            hint={`${formatBytes(storage.totalQuotaBytes)} allocated`}
          />
          <MetricCard
            icon={<FileText className="size-4" />}
            label="Assets"
            value={storage.totalAssets.toLocaleString()}
            hint={`${storage.imageCount} images · ${storage.pdfCount} PDFs`}
          />
          <MetricCard
            icon={<ImageIcon className="size-4" />}
            label="Public assets"
            value={storage.publicCount.toLocaleString()}
            hint={`${storage.privateCount} private`}
          />
          <MetricCard
            icon={<Database className="size-4" />}
            label="Tracked usage"
            value={formatBytes(storage.trackedUsedBytes)}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="grid gap-3 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent signups</h2>
            <Link
              href="/dashboard/admin/users"
              className="text-xs font-medium text-primary hover:underline"
            >
              Manage users
            </Link>
          </div>
          {recentUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <ul className="grid gap-1.5">
              {recentUsers.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 border border-border/50 bg-background/45 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {user.nickname ?? user.email ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.username ? `@${user.username}` : user.email ?? "No email"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {user.role === "admin" ? (
                      <Badge variant="default">admin</Badge>
                    ) : null}
                    {user.isBanActive ? (
                      <Badge variant="destructive">banned</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {user.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid content-start gap-2 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <h2 className="text-sm font-semibold">Quick links</h2>
          {[
            { label: "User management", href: "/dashboard/admin/users", icon: Users },
            { label: "Asset storage", href: "/dashboard/admin/assets", icon: HardDrive },
            { label: "Tags", href: "/dashboard/admin/tags", icon: Hash },
            { label: "Official docs", href: "/dashboard/admin/docs", icon: BookOpen },
          ].map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "justify-start gap-2",
                )}
              >
                <Icon className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </section>
      </div>
      </AdminShell>
    </>
  );
}
