import Link from "next/link";
import { FilePlus2, FileText, Globe2, Pencil } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
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
      <AdminShell>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Official documentation</h2>
        <form action={createOfficialDocAction}>
          <Button type="submit">
            <FilePlus2 className="size-4" />
            New official doc
          </Button>
        </form>
      </div>

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
      </AdminShell>
    </>
  );
}
