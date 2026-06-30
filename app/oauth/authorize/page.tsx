import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/db";
import { mcpClients } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { decideAuthorizationAction } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ErrorView({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md border border-border bg-card p-8 text-card-foreground">
        <h1 className="text-xl font-semibold">Authorization error</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const responseType = first(sp.response_type);
  const clientId = first(sp.client_id);
  const redirectUri = first(sp.redirect_uri);
  const codeChallenge = first(sp.code_challenge);
  const codeChallengeMethod = first(sp.code_challenge_method);
  const scope = first(sp.scope);
  const state = first(sp.state);
  const resource = first(sp.resource);

  if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge) {
    return <ErrorView message="This authorization request is missing required parameters." />;
  }

  if (codeChallengeMethod !== "S256") {
    return <ErrorView message="This authorization request must use PKCE with S256." />;
  }

  const [client] = await db
    .select({
      clientName: mcpClients.clientName,
      redirectUris: mcpClients.redirectUris,
    })
    .from(mcpClients)
    .where(eq(mcpClients.id, clientId))
    .limit(1);

  if (!client || !client.redirectUris.includes(redirectUri)) {
    return <ErrorView message="Unknown client, or the redirect URI is not registered." />;
  }

  const session = await auth();

  if (!session?.user?.id) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const single = first(value);
      if (single !== undefined) {
        params.set(key, single);
      }
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);
  }

  const appName = client.clientName?.trim() || "An application";
  const approveAction = decideAuthorizationAction.bind(null, "approve");
  const denyAction = decideAuthorizationAction.bind(null, "deny");

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md border border-border bg-card p-8 text-card-foreground shadow-sm">
        <ShieldCheck className="mb-5 size-8 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Authorize access</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">{appName}</span> wants to
          read and edit your Vault documents on your behalf as{" "}
          <span className="font-medium text-foreground">
            {session.user.email ?? session.user.name ?? "your account"}
          </span>
          .
        </p>

        <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
          <li>• List, search, and read your documents</li>
          <li>• Create documents and edit their contents</li>
        </ul>

        <form className="mt-8 flex gap-3">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input
            type="hidden"
            name="code_challenge_method"
            value={codeChallengeMethod}
          />
          {scope ? <input type="hidden" name="scope" value={scope} /> : null}
          {state ? <input type="hidden" name="state" value={state} /> : null}
          {resource ? (
            <input type="hidden" name="resource" value={resource} />
          ) : null}

          <Button
            type="submit"
            variant="outline"
            className="flex-1"
            formAction={denyAction}
          >
            Deny
          </Button>
          <Button type="submit" className="flex-1" formAction={approveAction}>
            Allow
          </Button>
        </form>
      </div>
    </main>
  );
}
