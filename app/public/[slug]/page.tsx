import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContentInteractionControl } from "@/components/content-interaction-control";
import { PublicStickerDisplay } from "@/components/extensions/PublicStickerDisplay";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createMarkdownExcerpt } from "@/lib/markdown";
import { listAssetResolutionsForDocument } from "@/server/assets";
import {
  getPublicDocumentBySlug,
  listPublicWikiLinkResolutions,
} from "@/server/documents";
import { recordContentView } from "@/server/content-interactions";
import { getCurrentContentViewerIdentity } from "@/server/content-viewer";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
import { getPublicStickerItems } from "@/server/sticker-state";
import { getPublicCalendarStates } from "@/server/calendar-state";

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
  const viewer = await getCurrentContentViewerIdentity();
  const document = await getPublicDocumentBySlug(slug, {
    userId: viewer.userId,
  });

  if (!document) {
    notFound();
  }

  const viewedStats = await recordContentView({
    target: { kind: "document", id: document.id },
    viewer,
  });
  const stats = viewedStats ?? document.stats;

  const [publicWikiLinks, guideWikiLinks, assetLinks, stickerItems, calendarStates] =
    await Promise.all([
      listPublicWikiLinkResolutions(),
      listOfficialDocWikiLinkResolutions(),
      listAssetResolutionsForDocument(document.id, null, document.markdown),
      getPublicStickerItems(document.id),
      getPublicCalendarStates(document.id),
    ]);
  const wikiLinks = {
    ...publicWikiLinks,
    ...guideWikiLinks,
  };
  const ownerName = document.ownerName ?? document.ownerUsername ?? "Vault user";
  const ownerHandle = document.ownerUsername ? `@${document.ownerUsername}` : null;
  const ownerInitial = ownerName.trim().charAt(0).toUpperCase() || "V";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-4xl px-2 py-8 sm:px-6 sm:py-12">
        <header className="vault-fade-up flex items-center justify-between px-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:px-0 sm:text-xs sm:tracking-[0.3em]">
          <span>Vault public note</span>
          <Link href="/" className="transition hover:text-foreground">
            Open Vault
          </Link>
        </header>

        <article className="vault-fade-up vault-delay-1 mt-8 text-card-foreground sm:mt-10">
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
          <ContentInteractionControl
            targetKind="document"
            targetId={document.id}
            initialStats={stats}
            canLike={Boolean(viewer.userId)}
            className="mt-5"
          />
          <div className="mt-7 border-t border-border/50 pt-5 sm:mt-8 sm:pt-7">
            <PublicStickerDisplay items={stickerItems}>
              <MarkdownDocument
                markdown={document.markdown}
                className="vault-public-markdown"
                wikiLinks={wikiLinks}
                assetLinks={assetLinks}
                documentId={document.id}
                calendarStates={calendarStates}
              />
            </PublicStickerDisplay>
          </div>
        </article>
      </div>
    </main>
  );
}
