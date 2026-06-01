import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeProfileAction, getCurrentUserProfile } from "@/server/profile";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getCurrentUserProfile();

  if (user.profileCompletedAt && user.username && user.nickname) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
        <div className="mb-6 flex justify-end">
          <ThemeToggle />
        </div>

        <section className="rounded-3xl border border-border/60 bg-card/85 p-7 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.65)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Finish profile
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
            Choose how people find you
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Your username is unique and searchable. Your nickname is free-form
            and can be changed later.
          </p>

          {error === "username-taken" ? (
            <div className="mt-5 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              That username is already taken.
            </div>
          ) : null}

          <form action={completeProfileAction} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Username
              <Input
                name="username"
                defaultValue={user.username ?? ""}
                placeholder="emre_b"
                required
                minLength={3}
                maxLength={30}
                pattern="[a-z0-9_]+"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Lowercase letters, numbers, and underscores only.
              </span>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Nickname
              <Input
                name="nickname"
                defaultValue={user.nickname ?? session.user.name ?? ""}
                placeholder="Emre"
                required
                maxLength={80}
              />
            </label>

            <Button type="submit" size="lg">
              Continue to Vault
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
