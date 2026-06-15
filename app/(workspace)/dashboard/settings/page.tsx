import { redirect } from "next/navigation";
import {
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
import { Button } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
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
    <>
      <WorkspacePageRegistration
        page={{ type: "settings", title: "Settings", href: "/dashboard/settings" }}
      />
      <section className="mx-auto grid w-full max-w-5xl gap-5 py-4">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Account
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Settings
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">Profile</Badge>
          </div>
        </header>

        <div className="grid gap-4">
          <div className="vault-fade-up border border-border/60 bg-card/45 p-5 text-card-foreground">
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

          <section className="vault-fade-up vault-delay-1 border border-border/60 bg-card/45 p-5 text-card-foreground">
            <UserRoundCog className="mb-4 size-6 text-primary" />
            <h2 className="text-lg font-semibold">Profile</h2>
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
            <section className="vault-fade-up vault-delay-2 border border-border/60 bg-card/45 p-5 text-card-foreground">
              <KeyRound className="mb-4 size-6 text-primary" />
              <h2 className="text-lg font-semibold">Authentication</h2>
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

            <section className="vault-fade-up vault-delay-3 border border-border/60 bg-card/45 p-5 text-card-foreground">
              <ShieldCheck className="mb-4 size-6 text-primary" />
              <h2 className="text-lg font-semibold">Privacy model</h2>
            </section>
          </div>
        </div>
      </section>
    </>
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
    <div className="flex flex-wrap items-center justify-between gap-3 border border-border/60 bg-background/50 px-4 py-3">
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
