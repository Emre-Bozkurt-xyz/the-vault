import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Home } from "lucide-react";

import { auth } from "@/auth";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { ThemeToggle } from "@/components/theme-toggle";
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
import type { WikiLinkResolutionMap } from "@/lib/wiki-links";
import { listPublicWikiLinkResolutions } from "@/server/documents";
import {
  getPublishedOfficialDocBySlug,
  listOfficialDocWikiLinkResolutions,
  listPublishedOfficialDocs,
} from "@/server/official-docs";
import { getWorkspaceData } from "@/server/workspace";

export const dynamic = "force-dynamic";

type PublishedOfficialDoc = Awaited<
  ReturnType<typeof listPublishedOfficialDocs>
>[number];

export default async function OfficialDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [doc, docs, guideWikiLinks, publicWikiLinks, session] = await Promise.all([
    getPublishedOfficialDocBySlug(slug),
    listPublishedOfficialDocs(),
    listOfficialDocWikiLinkResolutions(),
    listPublicWikiLinkResolutions(),
    auth(),
  ]);
  const wikiLinks = {
    ...publicWikiLinks,
    ...guideWikiLinks,
  };

  if (!doc) {
    notFound();
  }

  const groupedDocs = groupDocsByCategory(docs);

  if (session?.user?.id) {
    const workspace = await getWorkspaceData();

    return (
      <VaultWorkspaceShell
        activePage={{
          type: "guide",
          title: doc.title,
          href: `/docs/guides/${doc.slug}`,
        }}
        isAdmin={workspace.profile.role === "admin"}
        defaultPanelMode="docs"
        filePanel={
          <WorkspaceFileBrowser
            owned={workspace.owned}
            shared={workspace.shared}
            published={workspace.published}
            activeHref={`/docs/guides/${doc.slug}`}
          />
        }
        docsPanel={
          <WorkspaceDocsPanel
            docs={toWorkspaceGuideGroups(groupedDocs)}
            activeSlug={doc.slug}
          />
        }
        searchPanel={
          <WorkspaceSearchPanel
            owned={workspace.owned}
            shared={workspace.shared}
            publicDocuments={workspace.publicDocuments}
            guideGroups={workspace.guideGroups}
            activeHref={`/docs/guides/${doc.slug}`}
          />
        }
        galleryPanel={
          <WorkspaceGalleryPanel
            publicDocuments={workspace.publicDocuments}
            activeHref={`/docs/guides/${doc.slug}`}
          />
        }
        settingsPanel={
          <WorkspaceUtilityPanel
            mode="settings"
            activeHref={`/docs/guides/${doc.slug}`}
          />
        }
        adminPanel={
          <WorkspaceUtilityPanel
            mode="admin"
            activeHref={`/docs/guides/${doc.slug}`}
            isAdmin={workspace.profile.role === "admin"}
          />
        }
      >
        <GuideContent doc={doc} wikiLinks={wikiLinks} />
      </VaultWorkspaceShell>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 lg:grid-cols-[300px_1fr]">
        <DocsSidebar docs={groupedDocs} activeSlug={doc.slug} />

        <section className="min-w-0 border-border/60 lg:border-l">
          <DocsTopbar />

          <GuideContent doc={doc} wikiLinks={wikiLinks} />
        </section>
      </div>
    </main>
  );
}

function GuideContent({
  doc,
  wikiLinks,
}: {
  doc: NonNullable<Awaited<ReturnType<typeof getPublishedOfficialDocBySlug>>>;
  wikiLinks: WikiLinkResolutionMap;
}) {
  return (
    <article className="mx-auto w-full max-w-4xl px-0 py-8 sm:px-4 lg:px-8">
      <header className="border-b border-border/60 pb-8">
        <Badge variant="outline" className="mb-5">
          {doc.category}
        </Badge>
        <h1 className="text-5xl font-semibold tracking-tight text-balance vault-display sm:text-6xl">
          {doc.title}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Updated {doc.updatedAt.toLocaleDateString()}
        </p>
      </header>

      <div className="mt-10">
        <MarkdownDocument
          markdown={doc.markdown}
          className="max-w-4xl"
          wikiLinks={wikiLinks}
        />
      </div>
    </article>
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
  activeSlug,
}: {
  docs: { category: string; docs: PublishedOfficialDoc[] }[];
  activeSlug: string;
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
        {docs.map((group) => (
          <nav key={group.category} className="grid gap-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {group.category}
            </p>
            <div className="grid gap-1">
              {group.docs.map((doc) => {
                const active = doc.slug === activeSlug;

                return (
                  <Link
                    key={doc.id}
                    href={`/docs/guides/${doc.slug}`}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-sm transition",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {doc.title}
                  </Link>
                );
              })}
            </div>
          </nav>
        ))}
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
