import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { auth, signOut } from "@/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUserForAccess, isUserBanActive } from "@/server/authz";

export default async function BannedPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getCurrentUserForAccess();

  if (!isUserBanActive(user)) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-card-foreground shadow-sm">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">
          Account access paused
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This account is currently banned from Vault. Your documents are not
          deleted, but editing and viewing protected app areas are blocked.
        </p>

        <dl className="mt-6 grid gap-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
          <div>
            <dt className="font-medium text-foreground">Reason</dt>
            <dd className="mt-1 text-muted-foreground">
              {user.banReason || "No reason provided."}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Ends</dt>
            <dd className="mt-1 text-muted-foreground">
              {user.bannedUntil
                ? user.bannedUntil.toLocaleString()
                : "Permanent ban"}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button type="submit">Sign out</Button>
          </form>
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
