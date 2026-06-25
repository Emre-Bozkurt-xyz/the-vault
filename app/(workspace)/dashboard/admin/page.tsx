import {
  Ban,
  BookOpen,
  Hash,
  ShieldCheck,
  ShieldOff,
  UserRoundCog,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import {
  banUserAction,
  listUsersForAdmin,
  setUserRoleAction,
  unbanUserAction,
} from "@/server/admin";
import { requireAdmin } from "@/server/authz";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await requireAdmin();
  const { q, error } = await searchParams;
  const users = await listUsersForAdmin(q);

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "admin", title: "Admin", href: "/dashboard/admin" }}
      />
      <section className="mx-auto grid w-full max-w-7xl gap-5 py-4">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Moderation
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Admin
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/admin/tags"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-2",
              )}
            >
              <Hash className="size-4" />
              Tags
            </Link>
            <Link
              href="/dashboard/admin/docs"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-2",
              )}
            >
              <BookOpen className="size-4" />
              Official docs
            </Link>
          </div>
        </header>

        <section className="border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <UserRoundCog className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">Users</h2>
              </div>
            </div>
            <form className="flex w-full gap-2 md:max-w-md">
              <Input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search users"
                autoComplete="off"
                className="h-10"
              />
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
          </div>
          {error === "self-ban" ? (
            <p className="mt-4 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              You cannot ban your own admin account.
            </p>
          ) : null}
          {error === "self-demote" ? (
            <p className="mt-4 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              You cannot remove admin access from your own account.
            </p>
          ) : null}
        </section>

        <section className="grid gap-3">
          {users.map((user) => (
            <article
              key={user.id}
              className="border border-border/60 bg-card/45 p-4 text-card-foreground"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">
                      {user.nickname ?? user.email ?? "Unnamed user"}
                    </h3>
                    <Badge variant={user.role === "admin" ? "default" : "outline"}>
                      {user.role}
                    </Badge>
                    {user.isBanActive ? (
                      <Badge variant="destructive">Banned</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {user.username ? `@${user.username}` : "No username"} -{" "}
                    {user.email ?? "No email"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Joined {user.createdAt.toLocaleDateString()} - Updated{" "}
                    {user.updatedAt.toLocaleDateString()}
                  </p>
                  {user.bannedAt ? (
                    <p className="mt-3 border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      Ban reason: {user.banReason || "No reason provided."}
                      <br />
                      Ends:{" "}
                      {user.bannedUntil
                        ? user.bannedUntil.toLocaleString()
                        : "Permanent"}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2 xl:min-w-[520px]">
                  <form
                    action={setUserRoleAction}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="userId" value={user.id} />
                    <select
                      name="role"
                      defaultValue={user.role}
                      className="h-9 border border-input bg-background px-3 text-sm"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button type="submit" variant="outline">
                      <ShieldCheck className="size-4" />
                      Set role
                    </Button>
                  </form>

                  <form
                    action={banUserAction}
                    className="grid gap-2 border border-border/60 bg-background/50 p-3 sm:grid-cols-[120px_1fr_auto]"
                  >
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
                    <Button type="submit" variant="destructive">
                      <Ban className="size-4" />
                      Ban
                    </Button>
                  </form>

                  {user.bannedAt ? (
                    <form action={unbanUserAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <Button type="submit" variant="outline">
                        <ShieldOff className="size-4" />
                        Remove ban
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      </section>
    </>
  );
}
