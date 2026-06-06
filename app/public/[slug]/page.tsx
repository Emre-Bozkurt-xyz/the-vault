import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getPublicDocumentBySlug } from "@/server/documents";

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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
      <div className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
        <header className="vault-fade-up flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          <span>Vault public note</span>
          <Link href="/" className="transition hover:text-foreground">
            Open Vault
          </Link>
        </header>

        <article className="vault-fade-up vault-delay-1 mt-8 rounded-3xl border border-border/60 bg-card/80 p-8 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
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
          <div className="mt-8 border-t border-border/60 pt-6">
            <MarkdownDocument markdown={document.markdown} />
          </div>
        </article>
      </div>
    </main>
  );
}
