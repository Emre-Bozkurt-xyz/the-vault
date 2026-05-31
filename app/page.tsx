import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Database, FileText, Lock } from "lucide-react";

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
              Vault is a production-grade document platform: GitHub auth,
              PostgreSQL persistence, server-side permissions, rich-text editing,
              public sharing, and a home-lab deployment path.
            </p>
            <div className="vault-fade-up vault-delay-3 mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ size: "lg" }), "gap-1")}
              >
                Open dashboard
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/api/health"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Check health
              </Link>
            </div>
          </div>

          <div className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Current slice
                </p>
                <h2 className="mt-2 text-2xl font-semibold vault-display">
                  Running app shell
                </h2>
              </div>
              <CheckCircle2 className="size-6 text-primary" />
            </div>
            <div className="grid gap-3">
              <StatusRow icon={FileText} label="Next.js App Router" status="Ready" />
              <StatusRow icon={Database} label="PostgreSQL via Docker" status="Configured" />
              <StatusRow icon={Lock} label="Auth and permissions" status="Verified" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusRow({
  icon: Icon,
  label,
  status,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="size-4 text-primary" />
        <span className="font-medium">{label}</span>
      </div>
      <span className="text-sm text-muted-foreground">{status}</span>
    </div>
  );
}
