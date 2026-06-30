import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft, LogIn, LockKeyhole } from "lucide-react";

import { signIn, auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { devSignInAction, devSignInAsEmailAction, isDevLoginEnabled } from "@/server/dev-auth";

// Only allow same-origin relative callback paths to avoid open redirects.
function sanitizeCallbackUrl(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; devError?: string; callbackUrl?: string }>;
}) {
  const { error, devError, callbackUrl } = await searchParams;
  const redirectTo = sanitizeCallbackUrl(callbackUrl);

  const session = await auth();

  if (session?.user?.id) {
    redirect(redirectTo);
  }

  const showDevLogin = isDevLoginEnabled();
  const accountNotLinked = error === "OAuthAccountNotLinked";

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
              Sign in to continue to your workspace.
            </p>

            {accountNotLinked ? (
              <div className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-700 dark:text-amber-200">
                <div className="flex gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <p>
                    That email is already attached to another sign-in method.
                    Sign in with the provider you used first, then connect this
                    provider from Settings.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-8 grid gap-3">
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo });
                }}
              >
                <Button type="submit" className="w-full">
                  <LogIn className="size-4" />
                  Continue with GitHub
                </Button>
              </form>

              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo });
                }}
              >
                <Button type="submit" variant="outline" className="w-full">
                  <span
                    className="grid size-4 place-items-center text-xs font-semibold"
                    aria-hidden="true"
                  >
                    G
                  </span>
                  Continue with Google
                </Button>
              </form>
            </div>

            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              By signing in, you agree to the{" "}
              <Link href="/terms" className="text-primary underline-offset-4 hover:underline">
                Terms and Conditions
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>

            {showDevLogin ? (
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Local development
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <form action={devSignInAction}>
                    <input type="hidden" name="devUser" value="owner" />
                    <input type="hidden" name="callbackUrl" value={redirectTo} />
                    <Button type="submit" variant="outline" className="w-full">
                      Dev owner
                    </Button>
                  </form>
                  <form action={devSignInAction}>
                    <input type="hidden" name="devUser" value="collaborator" />
                    <input type="hidden" name="callbackUrl" value={redirectTo} />
                    <Button type="submit" variant="outline" className="w-full">
                      Dev collaborator
                    </Button>
                  </form>
                </div>
                <form action={devSignInAsEmailAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="callbackUrl" value={redirectTo} />
                  <input
                    type="email"
                    name="email"
                    placeholder="Sign in as existing user…"
                    required
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                  />
                  <Button type="submit" variant="outline" size="sm" className="shrink-0">
                    Go
                  </Button>
                </form>
                {devError ? (
                  <p className="mt-2 text-xs text-destructive">{devError}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
