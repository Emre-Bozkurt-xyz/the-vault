import Link from "next/link";
import { ArrowLeft, BookOpen, FilePlus2, FileText, Globe2, Pencil } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createOfficialDocAction,
  listOfficialDocsForAdmin,
} from "@/server/official-docs";

export default async function AdminOfficialDocsPage() {
  const docs = await listOfficialDocsForAdmin();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
          <Link
            href="/dashboard/admin"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Admin
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Official docs</Badge>
          </div>
        </header>

        <section className="rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <BookOpen className="size-6 text-primary" />
              <h1 className="mt-4 text-3xl font-semibold tracking-tight vault-display">
                Official documentation
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                These pages are public user-facing guides. They use manual saves,
                Repo-backed docs are canonical and read-only here. Database
                docs use manual saves, publish states, and no collaboration
                session.
              </p>
            </div>
            <form action={createOfficialDocAction}>
              <Button type="submit" size="lg">
                <FilePlus2 className="size-4" />
                New official doc
              </Button>
            </form>
          </div>
        </section>

        <section className="grid gap-4">
          {docs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border/70 bg-card/70 p-8 text-card-foreground">
              <p className="font-semibold">No official docs yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a draft to start building the help center.
              </p>
            </div>
          ) : (
            docs.map((doc) => (
              <article
                key={doc.id}
                className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{doc.title}</h2>
                    <Badge variant={doc.source === "repo" ? "secondary" : "outline"}>
                      {doc.source === "repo" ? "repo" : "database"}
                    </Badge>
                    <Badge
                      variant={
                        doc.status === "published"
                          ? "default"
                          : doc.status === "archived"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {doc.status}
                    </Badge>
                    {doc.source === "database" && doc.collidesWithRepo ? (
                      <Badge variant="destructive">slug collision</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {doc.category} / order {doc.sortOrder} - /docs/guides/{doc.slug} - Updated{" "}
                    {doc.updatedAt.toLocaleDateString()}
                  </p>
                  {doc.source === "repo" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Versioned file: {doc.filePath}
                    </p>
                  ) : doc.collidesWithRepo ? (
                    <p className="mt-1 text-xs text-destructive">
                      This database doc cannot be saved or published until its
                      slug is changed because a repo doc owns that slug.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {doc.status === "published" ? (
                    <Link
                      href={`/docs/guides/${doc.slug}`}
                      className={cn(buttonVariants({ variant: "outline" }))}
                    >
                      <Globe2 className="size-4" />
                      View
                    </Link>
                  ) : null}
                  {doc.editable ? (
                    <Link
                      href={`/dashboard/admin/docs/${doc.id}`}
                      className={cn(buttonVariants())}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        buttonVariants({ variant: "secondary" }),
                        "pointer-events-none",
                      )}
                    >
                      <FileText className="size-4" />
                      Read-only
                    </span>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
