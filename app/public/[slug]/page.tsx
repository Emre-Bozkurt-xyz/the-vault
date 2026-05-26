import { notFound } from "next/navigation";

import { ReadOnlyDocument } from "@/components/editor/ReadOnlyDocument";
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
        <p className="mb-4 text-sm text-muted-foreground">Published with Vault</p>
        <h1 className="text-4xl font-semibold tracking-tight">{document.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Updated {document.updatedAt.toLocaleDateString()}
        </p>
        <div className="mt-10 border-t border-border pt-8">
          <ReadOnlyDocument content={document.content} />
        </div>
      </article>
    </main>
  );
}
