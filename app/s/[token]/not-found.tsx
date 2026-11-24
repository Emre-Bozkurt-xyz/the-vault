import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** Any share link that doesn't work, for whatever reason, looks the same. */
export default function SharedLinkNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="max-w-md rounded-lg border border-border bg-card p-8 text-card-foreground">
        <p className="text-sm text-muted-foreground">Link unavailable</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This link doesn&apos;t work</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may have been turned off, have expired, or point to something that has been
          moved to the Bin. Ask the person who sent it for a new one.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          Go to Vault
        </Link>
      </section>
    </main>
  );
}
