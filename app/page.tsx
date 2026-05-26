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
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border pb-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
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

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl">
            <Badge className="mb-5 bg-primary text-primary-foreground hover:bg-primary">
              Phase 0 bootstrap
            </Badge>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
              Private notes first. Collaboration later.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Vault is being built as a production-style document platform:
              GitHub auth, PostgreSQL persistence, server-side permissions,
              rich-text editing, public sharing, and a home-lab deployment path.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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

          <div className="border border-border bg-card p-6 text-card-foreground shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Current slice</p>
                <h2 className="text-2xl font-semibold">Running app shell</h2>
              </div>
              <CheckCircle2 className="size-6 text-primary" />
            </div>
            <div className="grid gap-3">
              <StatusRow icon={FileText} label="Next.js App Router" status="Ready" />
              <StatusRow icon={Database} label="PostgreSQL via Docker" status="Configured" />
              <StatusRow icon={Lock} label="Auth and permissions" status="Next" />
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
    <div className="flex items-center justify-between border border-border bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="size-4 text-primary" />
        <span className="font-medium">{label}</span>
      </div>
      <span className="text-sm text-muted-foreground">{status}</span>
    </div>
  );
}
