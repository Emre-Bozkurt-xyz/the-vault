import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Globe2 } from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import {
  getPublicDocumentBySlug,
  listPublicWikiLinkResolutions,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

type WorkspacePublicDocumentPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function WorkspacePublicDocumentPage({
  params,
}: WorkspacePublicDocumentPageProps) {
  const { slug } = await params;
  const document = await getPublicDocumentBySlug(slug);

  if (!document) {
    notFound();
  }

  const [publicWikiLinks, guideWikiLinks] = await Promise.all([
    listPublicWikiLinkResolutions({ workspaceHrefs: true }),
    listOfficialDocWikiLinkResolutions(),
  ]);
  const wikiLinks = {
    ...publicWikiLinks,
    ...guideWikiLinks,
  };
  const ownerName = document.ownerName ?? document.ownerUsername ?? "Vault user";
  const ownerHandle = document.ownerUsername ? `@${document.ownerUsername}` : null;
  const ownerInitial = ownerName.trim().charAt(0).toUpperCase() || "V";
  const workspaceHref = `/workspace/public/${slug}`;
  const publicHref = `/public/${slug}`;

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "public",
          title: document.title,
          href: workspaceHref,
        }}
        rightPanel={
          <PublicDocumentContextPanel
            publicHref={publicHref}
            ownerName={ownerName}
            ownerHandle={ownerHandle}
            updatedAt={document.updatedAt}
          />
        }
      />
      <article className="vault-fade-up mx-auto grid min-h-full w-full max-w-[56rem] content-start gap-7 px-4 py-8 md:px-8 md:py-12">
        <header className="grid gap-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Public note
          </p>
          <h1 className="text-4xl font-semibold tracking-tight vault-display sm:text-5xl">
            {document.title}
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <Avatar size="lg" className="bg-background/70">
              {document.ownerImage ? (
                <AvatarImage src={document.ownerImage} alt="" />
              ) : null}
              <AvatarFallback>{ownerInitial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{ownerName}</p>
              <p className="text-muted-foreground">
                {ownerHandle ? `${ownerHandle} - ` : ""}
                Updated {document.updatedAt.toLocaleDateString()}
              </p>
            </div>
          </div>
        </header>

        <div className="border-t border-border/55 pt-6">
          <MarkdownDocument
            markdown={document.markdown}
            className="vault-public-markdown"
            wikiLinks={wikiLinks}
            contained={false}
          />
        </div>
      </article>
    </>
  );
}

function PublicDocumentContextPanel({
  publicHref,
  ownerName,
  ownerHandle,
  updatedAt,
}: {
  publicHref: string;
  ownerName: string;
  ownerHandle: string | null;
  updatedAt: Date;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3 text-sm">
      <section className="border-b border-border/70 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Public
            </p>
            <h2 className="mt-2 font-medium">Read-only document</h2>
          </div>
          <Globe2 className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          This workspace view is for signed-in browsing. Use the public page when
          sharing outside Vault.
        </p>
      </section>

      <section className="border-b border-border/70 py-3">
        <h2 className="font-medium">Publisher</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ownerName}
          {ownerHandle ? ` (${ownerHandle})` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Updated {updatedAt.toLocaleDateString()}
        </p>
      </section>

      <section className="py-3">
        <Link
          href={publicHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
        >
          <ExternalLink className="size-3.5" />
          Open public page
        </Link>
      </section>
    </div>
  );
}
