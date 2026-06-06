import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  BookOpen,
  ShieldCheck,
  ShieldOff,
  UserRoundCog,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Admin</Badge>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)]">
            <ShieldCheck className="size-6 text-primary" />
            <h1 className="mt-4 text-3xl font-semibold tracking-tight vault-display">
              Admin
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Moderate user access and manage official Vault documentation.
              Admin rights are checked from the database on every request.
            </p>
            <div className="mt-5 grid gap-2">
              <Link
                href="/dashboard/admin"
                className={cn(buttonVariants({ variant: "secondary" }), "justify-start")}
              >
                <UserRoundCog className="size-4" />
                Users
              </Link>
              <Link
                href="/dashboard/admin/docs"
                className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
              >
                <BookOpen className="size-4" />
                Official docs
              </Link>
            </div>
          </aside>

          <section className="grid gap-5">
            <div className="rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Users</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Search by nickname, username, or email. Bans block protected
                    app areas while preserving the account and its documents.
                  </p>
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
                <p className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  You cannot ban your own admin account.
                </p>
              ) : null}
              {error === "self-demote" ? (
                <p className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  You cannot remove admin access from your own account.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4">
              {users.map((user) => (
                <article
                  key={user.id}
                  className="rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground"
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
                        <p className="mt-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                          Ban reason: {user.banReason || "No reason provided."}
                          <br />
                          Ends:{" "}
                          {user.bannedUntil
                            ? user.bannedUntil.toLocaleString()
                            : "Permanent"}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-3 xl:min-w-[520px]">
                      <form
                        action={setUserRoleAction}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="userId" value={user.id} />
                        <select
                          name="role"
                          defaultValue={user.role}
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
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
                        className="grid gap-2 rounded-2xl border border-border/60 bg-background/50 p-3 sm:grid-cols-[120px_1fr_auto]"
                      >
                        <input type="hidden" name="userId" value={user.id} />
                        <select
                          name="duration"
                          defaultValue="7d"
                          className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
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
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
