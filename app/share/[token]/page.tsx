import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listAssetResolutionsForDocument } from "@/server/assets";
import {
  getDocumentByShareLink,
  listPublicWikiLinkResolutions,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

export default async function ShareLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  const shared = await getDocumentByShareLink(token, session?.user?.id ?? null);

  if (!shared) {
    notFound();
  }

  if (shared.requiresSignIn) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/share/${token}`)}`);
  }

  const document = shared.document;

  if (!document) {
    notFound();
  }

  if (session?.user?.id && document.access.canEdit) {
    redirect(`/docs/${document.id}?share=${token}`);
  }

  const [publicWikiLinks, guideWikiLinks, assetLinks] = await Promise.all([
    listPublicWikiLinkResolutions(),
    listOfficialDocWikiLinkResolutions(),
    listAssetResolutionsForDocument(document.id, session?.user?.id ?? null),
  ]);
  const wikiLinks = {
    ...publicWikiLinks,
    ...guideWikiLinks,
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-4xl px-3 py-8 sm:px-6 sm:py-12">
        <header className="flex items-center justify-between gap-3 border-b border-border/50 pb-5">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Vault
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session?.user?.id ? (
              <Link
                href={`/docs/${document.id}?share=${token}`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Open in Vault
              </Link>
            ) : (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/share/${token}`)}`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Sign in
              </Link>
            )}
          </div>
        </header>

        <article className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Shared link</Badge>
            <Badge variant="secondary">
              {document.access.canEdit ? "editor" : "viewer"}
            </Badge>
          </div>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight vault-display sm:text-6xl">
            {document.title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Updated {document.updatedAt.toLocaleDateString()}
          </p>
          {!session?.user?.id ? (
            <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
              You are viewing this shared document read-only. Sign in to Vault if
              the owner enabled member editing for this link.
            </p>
          ) : null}
          <div className="mt-8 border-t border-border/50 pt-7">
            <MarkdownDocument
              markdown={document.markdown}
              wikiLinks={wikiLinks}
              assetLinks={assetLinks}
            />
          </div>
        </article>
      </div>
    </main>
  );
}
