import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { OfficialDocEditor } from "@/components/markdown/OfficialDocEditor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOfficialDocForAdmin } from "@/server/official-docs";

export default async function AdminOfficialDocEditorPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const doc = await getOfficialDocForAdmin(docId);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-8 px-3 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
          <Link
            href="/dashboard/admin/docs"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Official docs
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">{doc.status}</Badge>
            {doc.status === "published" ? (
              <Link
                href={`/docs/guides/${doc.slug}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <ExternalLink className="size-4" />
                Public page
              </Link>
            ) : null}
          </div>
        </header>

        <OfficialDocEditor
          id={doc.id}
          title={doc.title}
          slug={doc.slug}
          category={doc.category}
          sortOrder={doc.sortOrder}
          markdown={doc.markdown}
          status={doc.status}
        />
      </div>
    </main>
  );
}
