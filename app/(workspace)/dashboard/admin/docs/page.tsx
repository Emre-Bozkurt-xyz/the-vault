import Link from "next/link";
import { FilePlus2, FileText, Globe2, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import {
  createOfficialDocAction,
  listOfficialDocsForAdmin,
} from "@/server/official-docs";

export default async function AdminOfficialDocsPage() {
  const docs = await listOfficialDocsForAdmin();

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "admin",
          title: "Official docs",
          href: "/dashboard/admin/docs",
        }}
      />
      <section className="mx-auto grid w-full max-w-6xl gap-5 py-4">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Admin
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Official documentation
            </h1>
          </div>
          <form action={createOfficialDocAction}>
            <Button type="submit">
              <FilePlus2 className="size-4" />
              New official doc
            </Button>
          </form>
        </header>

        <section className="grid gap-3">
          {docs.length === 0 ? (
            <div className="border border-dashed border-border/70 bg-card/45 p-8 text-card-foreground">
              <p className="font-semibold">No official docs yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a draft to start building the help center.
              </p>
            </div>
          ) : (
            docs.map((doc) => (
              <article
                key={doc.id}
                className="flex flex-col gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground md:flex-row md:items-center md:justify-between"
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
                    {doc.category} / order {doc.sortOrder} - /docs/guides/
                    {doc.slug} - Updated {doc.updatedAt.toLocaleDateString()}
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
      </section>
    </>
  );
}
