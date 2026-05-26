import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="max-w-md border border-border bg-card p-8 text-card-foreground">
        <p className="text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Nothing to show here
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The document may not exist, may be private, or may no longer be
          published.
        </p>
        <Link href="/dashboard" className={buttonVariants({ className: "mt-6" })}>
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
