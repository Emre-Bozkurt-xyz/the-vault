import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Home } from "lucide-react";

import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSettingsModalMount } from "@/components/settings/WorkspaceSettingsModalMount";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceDocsPanel } from "@/components/workspace/WorkspaceDocsPanel";
import { WorkspaceFileBrowser } from "@/components/workspace/WorkspaceFileBrowser";
import { WorkspaceGalleryPanel } from "@/components/workspace/WorkspaceGalleryPanel";
import { WorkspaceSearchPanel } from "@/components/workspace/WorkspaceSearchPanel";
import { WorkspaceUtilityPanel } from "@/components/workspace/WorkspaceUtilityPanel";
import { VaultWorkspaceShell } from "@/components/workspace/VaultWorkspaceShell";
import type { WorkspaceGuideGroup } from "@/components/workspace/workspace-types";
import { cn } from "@/lib/utils";
import { listPublishedOfficialDocs } from "@/server/official-docs";
import { getWorkspaceData } from "@/server/workspace";

export const dynamic = "force-dynamic";

type PublishedOfficialDoc = Awaited<
  ReturnType<typeof listPublishedOfficialDocs>
>[number];

export default async function OfficialDocsIndexPage() {
  const [docs, session] = await Promise.all([listPublishedOfficialDocs(), auth()]);
  const groupedDocs = groupDocsByCategory(docs);

  if (session?.user?.id) {
    const workspace = await getWorkspaceData();

    return (
      <>
      <VaultWorkspaceShell
        activePage={{ type: "guide", title: "Vault Docs", href: "/docs" }}
        isAdmin={workspace.profile.role === "admin"}
        defaultPanelMode="docs"
        initialLayout={workspace.layout}
        initialTabs={workspace.tabs}
        filePanel={
          <WorkspaceFileBrowser
            owned={workspace.owned}
            shared={workspace.shared}
            published={workspace.published}
            folders={workspace.folders}
            sharedFolders={workspace.sharedFolders}
            activeHref="/docs"
          />
        }
        docsPanel={<WorkspaceDocsPanel docs={toWorkspaceGuideGroups(groupedDocs)} />}
        searchPanel={
          <WorkspaceSearchPanel
            owned={workspace.owned}
            shared={workspace.shared}
            publicDocuments={workspace.publicDocuments}
            guideGroups={workspace.guideGroups}
            activeHref="/docs"
          />
        }
        galleryPanel={
          <WorkspaceGalleryPanel
            publicDocuments={workspace.publicDocuments}
            activeHref="/docs"
          />
        }
        adminPanel={
          <WorkspaceUtilityPanel
            mode="admin"
            activeHref="/docs"
            isAdmin={workspace.profile.role === "admin"}
          />
        }
      >
        <DocsIndexContent docs={docs} groupedDocs={groupedDocs} />
      </VaultWorkspaceShell>
      <WorkspaceSettingsModalMount profile={workspace.profile} />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 lg:grid-cols-[300px_1fr]">
        <DocsSidebar docs={groupedDocs} />

        <section className="min-w-0 border-border/60 lg:border-l">
          <DocsTopbar />

          <DocsIndexContent docs={docs} groupedDocs={groupedDocs} />
        </section>
      </div>
    </main>
  );
}

function DocsIndexContent({
  docs,
  groupedDocs,
}: {
  docs: PublishedOfficialDoc[];
  groupedDocs: { category: string; docs: PublishedOfficialDoc[] }[];
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-0 py-8 sm:px-4 lg:px-8">
      <header className="border-b border-border/60 pb-8">
        <Badge variant="outline" className="mb-5">
          <BookOpen className="size-3" />
          Official docs
        </Badge>
        <h1 className="text-5xl font-semibold tracking-tight text-balance vault-display sm:text-6xl">
          Vault documentation
        </h1>
      </header>

      {docs.length === 0 ? (
        <section className="mt-10 rounded-md border border-dashed border-border/70 bg-card/50 p-8 text-card-foreground">
          <FileText className="size-6 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">No docs published yet</h2>
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
              <div className="grid gap-2">
                {group.docs.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/docs/guides/${doc.slug}`}
                    className="group grid gap-2 rounded-md border border-border/60 bg-card/35 px-4 py-4 text-card-foreground transition hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="font-semibold tracking-tight">{doc.title}</h2>
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

function toWorkspaceGuideGroups(
  groups: { category: string; docs: PublishedOfficialDoc[] }[],
): WorkspaceGuideGroup[] {
  return groups.map((group) => ({
    category: group.category,
    docs: group.docs.map((doc) => ({
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      category: doc.category,
      href: `/docs/guides/${doc.slug}`,
    })),
  }));
}
