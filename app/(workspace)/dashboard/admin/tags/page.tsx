import Link from "next/link";
import { Hash, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { MetricCard } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import {
  createTagAction,
  createTagAliasAction,
  deleteAllUnusedTagsAction,
  deleteTagAliasAction,
  deleteUnusedTagAction,
  getAdminTagCategories,
  listTagsForAdmin,
  updateTagAction,
} from "@/server/tags-admin";

export default async function AdminTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q, filter } = await searchParams;
  const [tags, categories] = await Promise.all([
    listTagsForAdmin(q),
    getAdminTagCategories(),
  ]);
  const unusedTags = tags.filter(
    (tag) => tag.documentCount + tag.assetCount === 0 && tag.aliases.length === 0,
  );
  const aliasedUnusedTags = tags.filter(
    (tag) => tag.documentCount + tag.assetCount === 0 && tag.aliases.length > 0,
  );
  const visibleTags = filter === "unused" ? unusedTags : tags;
  const totalUses = tags.reduce(
    (total, tag) => total + tag.documentCount + tag.assetCount,
    0,
  );

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "admin",
          title: "Tags",
          href: "/dashboard/admin/tags",
        }}
      />
      <AdminShell>
      <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Hash className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">Canonical vocabulary</h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Author stable tags, add aliases for common variants, and remove
                unused spam tags once they have no content or aliases.
              </p>
            </div>
            <form className="flex w-full gap-2 lg:max-w-md">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Search tags"
                  autoComplete="off"
                  className="h-10 pl-9"
                />
              </label>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <MetricCard label="Tags shown" value={tags.length} />
            <MetricCard label="Total uses" value={totalUses} />
            <MetricCard label="Deletable unused" value={unusedTags.length} />
            <MetricCard label="Unused with aliases" value={aliasedUnusedTags.length} />
          </div>

          <div className="flex flex-col gap-3 border border-border/60 bg-background/45 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <Link
                href={
                  q
                    ? `/dashboard/admin/tags?q=${encodeURIComponent(q)}`
                    : "/dashboard/admin/tags"
                }
                className={cn(
                  buttonVariants({
                    variant: filter === "unused" ? "outline" : "secondary",
                    size: "sm",
                  }),
                )}
              >
                All
              </Link>
              <Link
                href={`/dashboard/admin/tags?${new URLSearchParams({
                  ...(q ? { q } : {}),
                  filter: "unused",
                }).toString()}`}
                className={cn(
                  buttonVariants({
                    variant: filter === "unused" ? "secondary" : "outline",
                    size: "sm",
                  }),
                )}
              >
                Deletable unused
              </Link>
            </div>
            <form action={deleteAllUnusedTagsAction}>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={unusedTags.length === 0}
              >
                <Trash2 className="size-4" />
                Delete all unused ({unusedTags.length})
              </Button>
            </form>
          </div>

          <form
            action={createTagAction}
            className="grid gap-3 border border-border/60 bg-background/50 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_minmax(0,1.5fr)_auto]"
          >
            <Input name="slug" placeholder="tag_slug" autoComplete="off" />
            <Input name="displayName" placeholder="Display name" autoComplete="off" />
            <select
              name="category"
              defaultValue="general"
              className="h-10 border border-input bg-background px-3 text-sm"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <Input
              name="description"
              placeholder="Description"
              autoComplete="off"
            />
            <Button type="submit">
              <Plus className="size-4" />
              Create
            </Button>
          </form>
        </section>

        <section className="grid gap-3">
          {visibleTags.length === 0 ? (
            <div className="border border-dashed border-border/70 bg-card/45 p-8 text-card-foreground">
              <p className="font-semibold">No tags found</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a canonical tag above, clear the search query, or switch
                filters.
              </p>
            </div>
          ) : (
            visibleTags.map((tag) => {
              const totalCount = tag.documentCount + tag.assetCount;
              const canDelete = totalCount === 0 && tag.aliases.length === 0;

              return (
                <article
                  key={tag.id}
                  className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-all text-lg font-semibold">
                          #{tag.slug}
                        </h2>
                        <Badge variant="outline">{tag.category}</Badge>
                        {totalCount === 0 ? (
                          <Badge variant="destructive">unused</Badge>
                        ) : (
                          <Badge variant="secondary">{totalCount} uses</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {tag.displayName}
                      </p>
                      {tag.description ? (
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                          {tag.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {tag.documentCount} documents - {tag.assetCount} assets -
                        {" "}
                        {tag.aliases.length} aliases
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canDelete ? (
                        <form action={deleteUnusedTagAction}>
                          <input type="hidden" name="tagId" value={tag.id} />
                          <Button type="submit" variant="destructive" size="sm">
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>

                  <details className="grid gap-3">
                    <summary
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "w-fit cursor-pointer list-none gap-2",
                      )}
                    >
                      <SlidersHorizontal className="size-4" />
                      Manage
                    </summary>
                    <form
                      action={updateTagAction}
                      className="grid gap-3 border border-border/60 bg-background/45 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_minmax(0,1.5fr)_auto]"
                    >
                      <input type="hidden" name="tagId" value={tag.id} />
                      <Input name="slug" defaultValue={tag.slug} />
                      <Input name="displayName" defaultValue={tag.displayName} />
                      <select
                        name="category"
                        defaultValue={tag.category}
                        className="h-10 border border-input bg-background px-3 text-sm"
                      >
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                      <Textarea
                        name="description"
                        defaultValue={tag.description ?? ""}
                        rows={1}
                        placeholder="Description"
                      />
                      <Button type="submit" variant="outline">
                        Save
                      </Button>
                    </form>

                    <div className="grid gap-2 border border-border/60 bg-background/45 p-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Aliases
                      </p>
                      {tag.aliases.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {tag.aliases.map((alias) => (
                            <form
                              key={alias.id}
                              action={deleteTagAliasAction}
                              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-xs"
                            >
                              <input
                                type="hidden"
                                name="aliasId"
                                value={alias.id}
                              />
                              <span>{alias.aliasSlug}</span>
                              <button
                                type="submit"
                                className="text-muted-foreground transition hover:text-destructive"
                                aria-label={`Delete alias ${alias.aliasSlug}`}
                              >
                                x
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No aliases yet.
                        </p>
                      )}

                      <form
                        action={createTagAliasAction}
                        className="flex max-w-lg gap-2"
                      >
                        <input type="hidden" name="tagId" value={tag.id} />
                        <Input
                          name="aliasSlug"
                          placeholder="alternate_slug"
                          autoComplete="off"
                        />
                        <Button type="submit" variant="outline">
                          Add alias
                        </Button>
                      </form>
                    </div>
                  </details>
                </article>
              );
            })
          )}
        </section>
      </AdminShell>
    </>
  );
}
