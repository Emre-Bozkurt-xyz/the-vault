import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Lock, Sparkles, Users } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border/60 pb-6">
          <Link
            href="/"
            className="text-lg font-semibold uppercase tracking-[0.3em] text-muted-foreground"
          >
            Vault
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ size: "sm" }), "gap-1")}
            >
              Dashboard
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-3xl">
            <Badge className="vault-fade-up mb-5 bg-primary text-primary-foreground hover:bg-primary">
              Private by default
            </Badge>
            <h1 className="vault-fade-up vault-delay-1 text-5xl font-semibold tracking-tight text-balance sm:text-7xl vault-display">
              A vault for focused writing, shared on your terms.
            </h1>
            <p className="vault-fade-up vault-delay-2 mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Write in Markdown, collaborate with trusted people, and publish
              only the pages you choose to share.
            </p>
            <div className="vault-fade-up vault-delay-3 mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ size: "lg" }), "gap-1")}
              >
                Open dashboard
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="vault-fade-up vault-delay-2 relative overflow-hidden rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Markdown workspace
                </p>
                <h2 className="mt-2 text-2xl font-semibold vault-display">
                  Write privately. Share deliberately.
                </h2>
              </div>
              <Sparkles className="size-5 text-primary" />
            </div>

            <div className="mt-6 rounded-2xl border border-border/70 bg-background/75 p-5 shadow-inner">
              <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="size-4" />
                <span>field-notes.md</span>
              </div>
              <div className="space-y-3">
                <p className="font-heading text-3xl font-semibold tracking-tight">
                  Launch notes
                </p>
                <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                  Draft in Markdown, keep collaborators close, and publish only
                  the pages meant to leave the vault.
                </p>
                <div className="grid gap-2 pt-2">
                  <PreviewLine icon={Lock} text="Private drafts by default" />
                  <PreviewLine icon={Users} text="Editor and viewer sharing" />
                  <PreviewLine icon={Sparkles} text="Live preview while writing" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5 text-xs text-muted-foreground">
          <span>Private by default. Public only when you publish.</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="transition hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="transition hover:text-foreground">
              Privacy
            </Link>
          </div>
        </footer>
      </section>
    </main>
  );
}

function PreviewLine({
  icon: Icon,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/35 px-3 py-2 text-sm">
      <Icon className="size-4 text-primary" />
      <span>{text}</span>
    </div>
  );
}
