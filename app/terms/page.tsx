import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTermsPage } from "@/lib/repo-docs";

export default async function TermsPage() {
  const page = await getTermsPage();

  if (!page) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-8">
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-6">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Sign in
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Terms</Badge>
          </div>
        </nav>

        <article className="rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] sm:p-8">
          <header className="border-b border-border/60 pb-6">
            <Badge variant="outline" className="mb-5">
              <FileText className="size-3" />
              Legal
            </Badge>
            <h1 className="text-5xl font-semibold tracking-tight vault-display">
              {page.title}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Updated {page.updatedAt.toLocaleDateString()}
            </p>
          </header>

          <div className="mt-8">
            <MarkdownDocument markdown={page.markdown} className="max-w-4xl" />
          </div>
        </article>
      </div>
    </main>
  );
}
