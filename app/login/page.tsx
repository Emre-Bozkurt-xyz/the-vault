import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LogIn, LockKeyhole } from "lucide-react";

import { signIn, auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { devSignInAction, isDevLoginEnabled } from "@/server/dev-auth";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user?.id) {
    redirect("/dashboard");
  }

  const showDevLogin = isDevLoginEnabled();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border pb-5">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>
          <ThemeToggle />
        </nav>

        <section className="grid flex-1 place-items-center py-12">
          <div className="w-full max-w-md border border-border bg-card p-8 text-card-foreground shadow-sm">
            <LockKeyhole className="mb-5 size-8 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight">
              Sign in to Vault
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              GitHub OAuth is the first authentication provider. Once signed in,
              Vault can attach every document operation to a server-verified
              user id.
            </p>

            <form
              className="mt-8"
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/dashboard" });
              }}
            >
              <Button type="submit" className="w-full">
                <LogIn className="size-4" />
                Continue with GitHub
              </Button>
            </form>

            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Local setup requires `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
              `AUTH_SECRET`, and `NEXTAUTH_URL` in `.env.local`.
            </p>

            {showDevLogin ? (
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Local development
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <form action={devSignInAction}>
                    <input type="hidden" name="devUser" value="owner" />
                    <Button type="submit" variant="outline" className="w-full">
                      Dev owner
                    </Button>
                  </form>
                  <form action={devSignInAction}>
                    <input type="hidden" name="devUser" value="collaborator" />
                    <Button type="submit" variant="outline" className="w-full">
                      Dev collaborator
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
