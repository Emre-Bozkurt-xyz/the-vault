import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";

import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const name = session.user.name ?? session.user.email ?? "Vault user";
  const fallback = name.slice(0, 1).toUpperCase();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Settings</Badge>
          </div>
        </header>

        <section className="grid gap-6">
          <div className="vault-fade-up rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="size-14">
                  <AvatarImage src={session.user.image ?? undefined} alt={name} />
                  <AvatarFallback>{fallback}</AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight vault-display">
                    {name}
                  </h1>
                  <p className="text-sm text-muted-foreground">{session.user.email}</p>
                </div>
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
              <KeyRound className="mb-4 size-6 text-primary" />
              <h2 className="text-lg font-semibold">Authentication</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Vault uses GitHub OAuth through Auth.js with database sessions
                stored in Postgres.
              </p>
            </section>

            <section className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
              <ShieldCheck className="mb-4 size-6 text-primary" />
              <h2 className="text-lg font-semibold">Privacy model</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Document reads and writes are checked server-side using
                owner/editor/viewer permissions.
              </p>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
