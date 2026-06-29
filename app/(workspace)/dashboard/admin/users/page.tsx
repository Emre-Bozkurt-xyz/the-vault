import Link from "next/link";
import { Search } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { UsersTable } from "@/components/admin/UsersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import { listUsersForAdmin } from "@/server/admin";
import { requireAdmin } from "@/server/authz";

const SORT_OPTIONS = [
  { label: "Newest", value: "joined_desc" },
  { label: "Oldest", value: "joined_asc" },
  { label: "Name (A–Z)", value: "name_asc" },
  { label: "Storage used", value: "storage_desc" },
  { label: "Role", value: "role_desc" },
];
const ROLE_OPTIONS = [
  { label: "All roles", value: "all" },
  { label: "Admins", value: "admin" },
  { label: "Users", value: "user" },
];
const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Banned", value: "banned" },
];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    role?: string;
    status?: string;
    sort?: string;
    page?: string;
    error?: string;
  }>;
}) {
  await requireAdmin();
  const { q, role, status, sort, page, error } = await searchParams;
  const currentPage = Number(page) > 0 ? Number(page) : 1;

  const result = await listUsersForAdmin({
    query: q,
    role,
    status,
    sort,
    page: currentPage,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rangeStart = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeEnd = Math.min(result.page * result.pageSize, result.total);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role && role !== "all") params.set("role", role);
    if (status && status !== "all") params.set("status", status);
    if (sort && sort !== "joined_desc") params.set("sort", sort);
    if (targetPage > 1) params.set("page", String(targetPage));
    const query = params.toString();
    return query ? `/dashboard/admin/users?${query}` : "/dashboard/admin/users";
  }

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "admin", title: "Users", href: "/dashboard/admin/users" }}
      />

      <AdminShell>
      {error === "self-ban" ? (
        <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          You cannot ban your own admin account.
        </p>
      ) : null}
      {error === "self-demote" ? (
        <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          You cannot remove admin access from your own account.
        </p>
      ) : null}

      <form className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]">
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
          name="role"
          defaultValue={role ?? "all"}
          className="h-10 border border-input bg-background px-3 text-sm"
          aria-label="Filter by role"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? "all"}
          className="h-10 border border-input bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort ?? "joined_desc"}
          className="h-10 border border-input bg-background px-3 text-sm"
          aria-label="Sort users"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      {result.items.length === 0 ? (
        <div className="border border-dashed border-border/70 bg-card/45 p-8 text-center">
          <p className="font-semibold">No users match</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Clear the search or adjust the filters.
          </p>
        </div>
      ) : (
        <>
          <UsersTable users={result.items} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {rangeStart}–{rangeEnd} of {result.total}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={pageHref(result.page - 1)}
                aria-disabled={result.page <= 1}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  result.page <= 1 && "pointer-events-none opacity-50",
                )}
              >
                Previous
              </Link>
              <span className="text-xs">
                Page {result.page} of {totalPages}
              </span>
              <Link
                href={pageHref(result.page + 1)}
                aria-disabled={result.page >= totalPages}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  result.page >= totalPages && "pointer-events-none opacity-50",
                )}
              >
                Next
              </Link>
            </div>
          </div>
        </>
      )}
      </AdminShell>
    </>
  );
}
