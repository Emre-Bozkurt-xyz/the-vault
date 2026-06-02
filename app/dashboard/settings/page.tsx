import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LinkIcon,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";

import { auth, signIn, signOut } from "@/auth";
import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listConnectedAuthProviders,
  requireCompletedProfile,
} from "@/server/profile";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; saved?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const connectedProviders = await listConnectedAuthProviders();
  const { connected, error, saved } = await searchParams;
  const name = profile.nickname ?? profile.email ?? "Vault user";
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
                  <AvatarImage src={profile.image ?? undefined} alt={name} />
                  <AvatarFallback>{fallback}</AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight vault-display">
                    {name}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    @{profile.username} - {profile.email}
                  </p>
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

          <section className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
            <UserRoundCog className="mb-4 size-6 text-primary" />
            <h2 className="text-lg font-semibold">Profile</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Your username is unique and searchable. Your nickname is
              free-form. Friends, shared documents, and collaborator access stay
              attached to your account ID when your username changes.
            </p>
            <div className="mt-5 max-w-md">
              <ProfileSettingsForm
                username={profile.username ?? ""}
                nickname={profile.nickname ?? ""}
                error={error}
                saved={saved}
              />
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
              <KeyRound className="mb-4 size-6 text-primary" />
              <h2 className="text-lg font-semibold">Authentication</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Connect OAuth providers to this Vault account. Linked providers
                all resolve to the same user id, so friends, documents, and
                collaborator access stay attached.
              </p>
              {connected === "google" || connected === "github" ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
                  {connected === "google" ? "Google" : "GitHub"} is connected.
                </div>
              ) : null}
              <div className="mt-5 grid gap-3">
                <AuthProviderRow
                  providerName="GitHub"
                  connected={connectedProviders.github}
                  connectAction={async () => {
                    "use server";
                    await signIn("github", {
                      redirectTo: "/dashboard/settings?connected=github",
                    });
                  }}
                />
                <AuthProviderRow
                  providerName="Google"
                  connected={connectedProviders.google}
                  connectAction={async () => {
                    "use server";
                    await signIn("google", {
                      redirectTo: "/dashboard/settings?connected=google",
                    });
                  }}
                />
              </div>
            </section>

            <section className="vault-fade-up vault-delay-3 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
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

function AuthProviderRow({
  providerName,
  connected,
  connectAction,
}: {
  providerName: string;
  connected: boolean;
  connectAction: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/50 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{providerName}</p>
        <p className="text-xs text-muted-foreground">
          {connected ? "Available for sign-in." : "Not connected yet."}
        </p>
      </div>
      {connected ? (
        <Badge variant="outline" className="gap-1.5">
          <CheckCircle2 className="size-3.5" />
          Connected
        </Badge>
      ) : (
        <form action={connectAction}>
          <Button type="submit" size="sm" variant="outline">
            <LinkIcon className="size-4" />
            Connect
          </Button>
        </form>
      )}
    </div>
  );
}
