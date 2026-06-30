import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { createMarkdownExcerpt } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { listAssetResolutionsForDocument } from "@/server/assets";
import {
  getDocumentByShareLink,
  listPublicWikiLinkResolutions,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

type ShareLinkPageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({
  params,
}: ShareLinkPageProps): Promise<Metadata> {
  const { token } = await params;
  const shared = await getDocumentByShareLink(token, null);

  if (!shared?.document) {
    return {
      title: "Shared Vault document",
      description: "Sign in to Vault to open this shared document.",
      robots: { index: false, follow: false },
    };
  }

  const document = shared.document;
  const description = createMarkdownExcerpt(document.markdown);
  const imageUrl = `/share/${encodeURIComponent(token)}/og`;

  return {
    title: `${document.title} · Vault`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: document.title,
      description,
      type: "article",
      url: `/share/${token}`,
      siteName: "Vault",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${document.title} shared through Vault`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: document.title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ShareLinkPage({ params }: ShareLinkPageProps) {
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
    listAssetResolutionsForDocument(
      document.id,
      session?.user?.id ?? null,
      document.markdown,
    ),
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
