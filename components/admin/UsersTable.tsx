"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  CodeXml,
  FileUp,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { UsageBar } from "@/components/admin/metric-card";
import { QuotaOverrideForm } from "@/components/admin/QuotaOverrideForm";
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
  setCodeExecutionAction,
  setUnrestrictedUploadsAction,
  setUserRoleAction,
  unbanUserAction,
  type AdminUserListItem,
} from "@/server/admin";
import { recalcUserStorageAction } from "@/server/assets-admin";
import type { UserTier } from "@/server/user-tiers";
import { setUserTierAction } from "@/server/user-tiers-admin";

export function UsersTable({ users, tiers, executionEnabled }: {
  users: AdminUserListItem[];
  tiers: UserTier[];
  executionEnabled: boolean;
}) {
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
              <th className="px-3 py-2 font-semibold">Tier</th>
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
                <td className="px-3 py-2.5 text-xs">
                  {user.tierName ?? "None"}
                  {user.tierId === null ? (
                    <span className="ml-1 text-muted-foreground">(default)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {user.isBanActive ? (
                      <Badge variant="destructive">banned</Badge>
                    ) : (
                      <Badge variant="secondary">active</Badge>
                    )}
                    {user.codeExecutionAllowed ? (
                      <Badge variant="outline" title="May run code blocks">runs code</Badge>
                    ) : null}
                    {user.unrestrictedUploadsAllowed ? (
                      <Badge variant="outline" title="May upload any file type">any upload</Badge>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {formatBytes(user.storageUsedBytes)} /{" "}
                  {formatBytes(user.storageQuotaBytes)}
                  {user.storageQuotaOverrideBytes !== null ? (
                    <span className="ml-1" title="Custom quota, not the tier's">*</span>
                  ) : null}
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
            <UserDetail user={selected} tiers={tiers} executionEnabled={executionEnabled} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function UserDetail({ user, tiers, executionEnabled }: {
  user: AdminUserListItem;
  tiers: UserTier[];
  executionEnabled: boolean;
}) {
  const defaultTier = tiers.find((tier) => tier.isDefault);

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

      {/* Tier */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Tier
        </h3>
        <p className="text-sm text-muted-foreground">
          Sets this user&apos;s storage and upload allowances, unless they have
          their own below.{" "}
          <Link href="/dashboard/admin/tiers" className="underline underline-offset-4">
            Edit tiers
          </Link>
        </p>
        <form
          key={user.tierId ?? "default"}
          action={setUserTierAction}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="userId" value={user.id} />
          <select
            name="tierId"
            defaultValue={user.tierId ?? "default"}
            className="h-9 flex-1 border border-input bg-background px-3 text-sm"
            aria-label="Tier"
          >
            <option value="default">
              Default{defaultTier ? ` (${defaultTier.name})` : ""}
            </option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            <Layers className="size-4" />
            Set
          </Button>
        </form>
      </section>

      {/* Code execution */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Code execution
        </h3>
        <p className="text-sm text-muted-foreground">
          {user.codeExecutionAllowed
            ? "Can run code blocks in documents they can edit."
            : "Cannot run code. Run and Input are hidden from them."}
          {executionEnabled ? "" : " Running code is switched off for this deployment, so this has no effect until CODE_EXECUTION_ENABLED=true."}
        </p>
        <form action={setCodeExecutionAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="allowed" value={user.codeExecutionAllowed ? "false" : "true"} />
          <Button type="submit" variant="outline" size="sm">
            <CodeXml className="size-4" />
            {user.codeExecutionAllowed ? "Revoke code execution" : "Allow code execution"}
          </Button>
        </form>
      </section>

      {/* Uploads */}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Uploads
        </h3>
        <p className="text-sm text-muted-foreground">
          {user.unrestrictedUploadsAllowed
            ? "Can upload any file type. Files outside images, PDFs and videos are only ever served as downloads."
            : "Can upload images, PDFs and videos only."}{" "}
          {user.unrestrictedUploadsOverride === null
            ? `From the ${user.tierName ?? "default"} tier.`
            : "Set for this user, not by their tier."}
        </p>
        <form
          key={String(user.unrestrictedUploadsOverride)}
          action={setUnrestrictedUploadsAction}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="userId" value={user.id} />
          <select
            name="allowed"
            defaultValue={
              user.unrestrictedUploadsOverride === null
                ? "inherit"
                : String(user.unrestrictedUploadsOverride)
            }
            className="h-9 flex-1 border border-input bg-background px-3 text-sm"
            aria-label="Upload file types"
          >
            <option value="inherit">
              From tier ({user.tierUnrestrictedUploads ? "any file type" : "images, PDFs, videos"})
            </option>
            <option value="true">Any file type</option>
            <option value="false">Images, PDFs and videos only</option>
          </select>
          <Button type="submit" variant="outline" size="sm">
            <FileUp className="size-4" />
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
        <QuotaOverrideForm userId={user.id} allowance={user} />
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
