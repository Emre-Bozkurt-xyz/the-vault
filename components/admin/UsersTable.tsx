"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { UsageBar } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  banUserAction,
  setUserRoleAction,
  unbanUserAction,
  type AdminUserListItem,
} from "@/server/admin";
import {
  recalcUserStorageAction,
  updateUserQuotaAction,
} from "@/server/assets-admin";

const MIB = 1024 * 1024;

export function UsersTable({ users }: { users: AdminUserListItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = users.find((user) => user.id === selectedId) ?? null;

  return (
    <>
      <div className="overflow-x-auto border border-border/60 bg-card/45">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Storage</th>
              <th className="px-3 py-2 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                onClick={() => setSelectedId(user.id)}
                className="cursor-pointer border-b border-border/40 transition last:border-0 hover:bg-sidebar-accent/40"
              >
                <td className="px-3 py-2.5">
                  <p className="font-medium">
                    {user.nickname ?? user.email ?? "Unnamed user"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {user.username ? `@${user.username}` : user.email ?? "No email"}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={user.role === "admin" ? "default" : "outline"}>
                    {user.role}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  {user.isBanActive ? (
                    <Badge variant="destructive">banned</Badge>
                  ) : (
                    <Badge variant="secondary">active</Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {formatBytes(user.storageUsedBytes)} /{" "}
                  {formatBytes(user.storageQuotaBytes)}
                  <span className="ml-1">({user.assetCount})</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {user.createdAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent>
          {selected ? (
            <UserDetail user={selected} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function UserDetail({ user }: { user: AdminUserListItem }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{user.nickname ?? user.email ?? "Unnamed user"}</SheetTitle>
        <p className="text-sm text-muted-foreground">
          {user.username ? `@${user.username} · ` : ""}
          {user.email ?? "No email"}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge variant={user.role === "admin" ? "default" : "outline"}>
            {user.role}
          </Badge>
          {user.isBanActive ? (
            <Badge variant="destructive">banned</Badge>
          ) : (
            <Badge variant="secondary">active</Badge>
          )}
        </div>
      </SheetHeader>

      <p className="text-xs text-muted-foreground">
        Joined {user.createdAt.toLocaleDateString()} · Updated{" "}
        {user.updatedAt.toLocaleDateString()}
      </p>

      {/* Role */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Role
        </h3>
        <form action={setUserRoleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <select
            name="role"
            defaultValue={user.role}
            className="h-9 flex-1 border border-input bg-background px-3 text-sm"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" variant="outline" size="sm">
            <ShieldCheck className="size-4" />
            Set
          </Button>
        </form>
      </section>

      {/* Ban */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Moderation
        </h3>
        {user.bannedAt ? (
          <div className="grid gap-2">
            <p className="border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Reason: {user.banReason || "No reason provided."}
              <br />
              Ends:{" "}
              {user.bannedUntil
                ? user.bannedUntil.toLocaleString()
                : "Permanent"}
            </p>
            <form action={unbanUserAction}>
              <input type="hidden" name="userId" value={user.id} />
              <Button type="submit" variant="outline" size="sm">
                <ShieldOff className="size-4" />
                Remove ban
              </Button>
            </form>
          </div>
        ) : (
          <form action={banUserAction} className="grid gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <select
              name="duration"
              defaultValue="7d"
              className="h-9 border border-input bg-background px-3 text-sm"
            >
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="forever">Forever</option>
            </select>
            <Input
              name="reason"
              placeholder="Reason visible to the user"
              autoComplete="off"
              className="h-9"
            />
            <Button type="submit" variant="destructive" size="sm">
              <Ban className="size-4" />
              Ban user
            </Button>
          </form>
        )}
      </section>

      {/* Storage */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Storage
        </h3>
        <UsageBar used={user.storageUsedBytes} quota={user.storageQuotaBytes} />
        <p className="text-xs text-muted-foreground">{user.assetCount} assets</p>
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
            defaultValue={Math.round(user.storageQuotaBytes / MIB)}
            className="h-9 w-28"
            aria-label="Storage quota in MiB"
          />
          <Button type="submit" variant="outline" size="sm">
            Set quota
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <form action={recalcUserStorageAction}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw className="size-4" />
              Recalculate
            </Button>
          </form>
          <Link
            href={`/dashboard/admin/assets?userId=${user.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
          >
            <HardDrive className="size-4" />
            View assets
          </Link>
        </div>
      </section>
    </>
  );
}
