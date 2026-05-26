"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="max-w-md border border-border bg-card p-8 text-card-foreground">
        <p className="text-sm text-muted-foreground">Error</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Something failed
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The app hit an unexpected problem while loading this view.
        </p>
        <Button type="button" onClick={reset} className="mt-6">
          Try again
        </Button>
      </section>
    </main>
  );
}
