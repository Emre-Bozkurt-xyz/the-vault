import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Home } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listPublishedOfficialDocs } from "@/server/official-docs";

export const dynamic = "force-dynamic";

type PublishedOfficialDoc = Awaited<
  ReturnType<typeof listPublishedOfficialDocs>
>[number];

export default async function OfficialDocsIndexPage() {
  const docs = await listPublishedOfficialDocs();
  const groupedDocs = groupDocsByCategory(docs);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 lg:grid-cols-[300px_1fr]">
        <DocsSidebar docs={groupedDocs} />

        <section className="min-w-0 border-border/60 lg:border-l">
          <DocsTopbar />

          <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:px-12">
            <header className="border-b border-border/60 pb-10">
              <Badge variant="outline" className="mb-5">
                <BookOpen className="size-3" />
                Official docs
              </Badge>
              <h1 className="text-5xl font-semibold tracking-tight text-balance vault-display sm:text-6xl">
                Vault documentation
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">
                User-facing guides for Markdown writing, callouts, snippets,
                safe HTML, media embeds, collaboration, and publishing.
              </p>
            </header>

            {docs.length === 0 ? (
              <section className="mt-10 rounded-2xl border border-dashed border-border/70 bg-card/70 p-8 text-card-foreground">
                <FileText className="size-6 text-muted-foreground" />
                <h2 className="mt-4 text-xl font-semibold">
                  No docs published yet
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Published official docs will appear here.
                </p>
              </section>
            ) : (
              <div className="mt-10 grid gap-10">
                {groupedDocs.map((group) => (
                  <section key={group.category} className="grid gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        {group.category}
                      </p>
                      <div className="mt-2 h-px bg-border/70" />
                    </div>
                    <div className="grid gap-3">
                      {group.docs.map((doc) => (
                        <Link
                          key={doc.id}
                          href={`/docs/guides/${doc.slug}`}
                          className="group grid gap-2 rounded-xl border border-border/60 bg-card/65 px-4 py-4 text-card-foreground transition hover:border-primary/40 hover:bg-muted/30"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <h2 className="font-semibold tracking-tight">
                              {doc.title}
                            </h2>
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                          </div>
                          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            Updated {doc.updatedAt.toLocaleDateString()}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function DocsTopbar() {
  return (
    <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 bg-background/90 px-5 py-3 backdrop-blur sm:px-8 lg:px-12">
      <Link
        href="/"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
      >
        <Home className="size-4" />
        Vault
      </Link>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
          Dashboard
        </Link>
      </div>
    </nav>
  );
}

function DocsSidebar({
  docs,
}: {
  docs: { category: string; docs: PublishedOfficialDoc[] }[];
}) {
  return (
    <aside className="border-b border-border/60 bg-card/35 px-5 py-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:px-6">
      <Link href="/docs" className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl border border-border/70 bg-background">
          <BookOpen className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-semibold">Vault Docs</span>
          <span className="block text-xs text-muted-foreground">
            Official guides
          </span>
        </span>
      </Link>

      <div className="mt-7 grid gap-6">
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No published docs.</p>
        ) : (
          docs.map((group) => (
            <nav key={group.category} className="grid gap-2">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {group.category}
              </p>
              <div className="grid gap-1">
                {group.docs.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/docs/guides/${doc.slug}`}
                    className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                  >
                    {doc.title}
                  </Link>
                ))}
              </div>
            </nav>
          ))
        )}
      </div>
    </aside>
  );
}

function groupDocsByCategory(docs: PublishedOfficialDoc[]) {
  const groups = new Map<string, PublishedOfficialDoc[]>();

  for (const doc of docs) {
    const category = doc.category || "Guides";
    groups.set(category, [...(groups.get(category) ?? []), doc]);
  }

  return Array.from(groups.entries()).map(([category, groupDocs]) => ({
    category,
    docs: groupDocs,
  }));
}
