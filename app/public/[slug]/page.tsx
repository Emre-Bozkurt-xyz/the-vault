import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createMarkdownExcerpt } from "@/lib/markdown";
import { getPublicDocumentBySlug } from "@/server/documents";

type PublicDocumentPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PublicDocumentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = await getPublicDocumentBySlug(slug);

  if (!document) {
    return {
      title: "Public note not found · Vault",
    };
  }

  const ownerName = document.ownerName ?? document.ownerUsername ?? "Vault user";
  const ownerHandle = document.ownerUsername ? `@${document.ownerUsername}` : null;
  const title = `${document.title} · Vault`;
  const description = createMarkdownExcerpt(document.markdown);
  const byline = ownerHandle ? `${ownerName} (${ownerHandle})` : ownerName;
  const imageUrl = `/public/${encodeURIComponent(slug)}/og`;

  return {
    title,
    description,
    alternates: {
      canonical: `/public/${slug}`,
    },
    authors: [{ name: byline }],
    openGraph: {
      title: document.title,
      description,
      type: "article",
      url: `/public/${slug}`,
      siteName: "Vault",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${document.title} by ${byline}`,
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

export default async function PublicDocumentPage({
  params,
}: PublicDocumentPageProps) {
  const { slug } = await params;
  const document = await getPublicDocumentBySlug(slug);

  if (!document) {
    notFound();
  }

  const ownerName = document.ownerName ?? document.ownerUsername ?? "Vault user";
  const ownerHandle = document.ownerUsername ? `@${document.ownerUsername}` : null;
  const ownerInitial = ownerName.trim().charAt(0).toUpperCase() || "V";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-3xl px-1.5 py-8 sm:px-6 sm:py-12">
        <header className="vault-fade-up flex items-center justify-between px-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:px-0 sm:text-xs sm:tracking-[0.3em]">
          <span>Vault public note</span>
          <Link href="/" className="transition hover:text-foreground">
            Open Vault
          </Link>
        </header>

        <article className="vault-fade-up vault-delay-1 mt-6 rounded-[1.35rem] border border-border/60 bg-card/80 p-3.5 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur sm:mt-8 sm:rounded-3xl sm:p-8">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:text-xs sm:tracking-[0.3em]">
            Published with Vault
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl vault-display">
            {document.title}
          </h1>
          <div className="mt-5 flex items-center gap-3 text-sm">
            <Avatar size="lg" className="bg-background/70">
              {document.ownerImage ? (
                <AvatarImage src={document.ownerImage} alt="" />
              ) : null}
              <AvatarFallback>{ownerInitial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{ownerName}</p>
              <p className="text-muted-foreground">
                {ownerHandle ? `${ownerHandle} · ` : ""}
                Updated {document.updatedAt.toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="mt-7 border-t border-border/60 pt-5 sm:mt-8 sm:pt-6">
            <MarkdownDocument
              markdown={document.markdown}
              className="vault-public-markdown"
            />
          </div>
        </article>
      </div>
    </main>
  );
}
