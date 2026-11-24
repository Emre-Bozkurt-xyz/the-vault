import Link from "next/link";
import { Layers, Plus, Save, Star, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/authz";
import { listUserTiers, type UserTier } from "@/server/user-tiers";
import {
  createTierAction,
  deleteTierAction,
  setDefaultTierAction,
  updateTierAction,
} from "@/server/user-tiers-admin";

const MIB = 1024 * 1024;

const ERRORS: Record<string, string> = {
  TIER_NAME_TAKEN: "Another tier already has that name.",
  DEFAULT_TIER: "The default tier can't be deleted. Make another tier the default first.",
  TIER_NOT_FOUND: "That tier no longer exists.",
};

export default async function AdminTiersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;
  const tiers = await listUserTiers();

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "admin", title: "Tiers", href: "/dashboard/admin/tiers" }}
      />
      <AdminShell>
        {error && ERRORS[error] ? (
          <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {ERRORS[error]}
          </p>
        ) : null}

        <section className="grid gap-4 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Layers className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Tiers</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              A tier sets how much storage its users get and whether they may
              upload any file type. Everyone without a tier of their own,
              including new signups, follows the default tier. A user&apos;s own
              quota or upload setting (on the Users page) wins over their
              tier&apos;s. Changes apply on each user&apos;s next upload. Lowering a
              quota never deletes files; users over it just can&apos;t upload more.
            </p>
          </div>

          <div className="grid gap-3">
            {tiers.map((tier) => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        </section>

        <section className="grid gap-3 border border-border/60 bg-card/45 p-4 text-card-foreground">
          <div className="flex items-center gap-2">
            <Plus className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">New tier</h2>
          </div>
          <TierFields action={createTierAction} submitLabel="Create tier" />
        </section>

        <p className="text-sm text-muted-foreground">
          Put users on a tier from{" "}
          <Link href="/dashboard/admin/users" className="underline underline-offset-4">
            Users
          </Link>
          .
        </p>
      </AdminShell>
    </>
  );
}

function TierCard({ tier }: { tier: UserTier }) {
  return (
    <article
      className={cn(
        "grid gap-3 border bg-background/45 p-4",
        tier.isDefault ? "border-primary/50" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{tier.name}</h3>
        {tier.isDefault ? <Badge>default</Badge> : null}
        <Badge variant="secondary">
          {tier.memberCount} {tier.memberCount === 1 ? "user" : "users"}
        </Badge>
      </div>

      <TierFields action={updateTierAction} tier={tier} submitLabel="Save" />

      <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        {tier.isDefault ? (
          <p className="text-xs text-muted-foreground">
            New signups and users without a tier follow this one.
          </p>
        ) : (
          <>
            <form action={setDefaultTierAction}>
              <input type="hidden" name="tierId" value={tier.id} />
              <Button type="submit" variant="outline" size="sm">
                <Star className="size-4" />
                Make default
              </Button>
            </form>
            <form action={deleteTierAction}>
              <input type="hidden" name="tierId" value={tier.id} />
              <Button type="submit" variant="outline" size="sm" className="text-destructive">
                <Trash2 className="size-4" />
                Delete
              </Button>
            </form>
            {tier.memberCount > 0 ? (
              <p className="self-center text-xs text-muted-foreground">
                Deleting moves its {tier.memberCount === 1 ? "user" : "users"} to the default tier.
              </p>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

function TierFields({
  action,
  tier,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  tier?: UserTier;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto] sm:items-end">
      {tier ? <input type="hidden" name="tierId" value={tier.id} /> : null}
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Name</span>
        <Input
          name="name"
          required
          maxLength={40}
          defaultValue={tier?.name ?? ""}
          placeholder="e.g. Plus"
          autoComplete="off"
          className="h-9"
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Storage (MiB)
        </span>
        <Input
          type="number"
          name="quotaMb"
          required
          min={0}
          step={1}
          defaultValue={tier ? Math.round(tier.storageQuotaBytes / MIB) : 50}
          className="h-9"
        />
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="unrestricted"
          defaultChecked={tier?.unrestrictedUploadsAllowed ?? false}
          className="size-4 accent-primary"
        />
        Any file type
      </label>
      <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
        <Save className="size-4" />
        {submitLabel}
      </button>
    </form>
  );
}
