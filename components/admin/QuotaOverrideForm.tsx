import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/format";
import { updateUserQuotaAction } from "@/server/assets-admin";
import type { UserAllowance } from "@/server/user-tiers";

const MIB = 1024 * 1024;

/**
 * A user's storage quota: blank follows their tier, a number is their own.
 * Shared by the Users sheet and the Assets page.
 */
export function QuotaOverrideForm({
  userId,
  allowance,
}: {
  userId: string;
  allowance: UserAllowance;
}) {
  const custom = allowance.storageQuotaOverrideBytes !== null;
  const tierLabel = allowance.tierName ?? "default";
  const tierQuota =
    allowance.tierStorageQuotaBytes === null ? null : formatBytes(allowance.tierStorageQuotaBytes);

  return (
    <div className="grid gap-1.5">
      {/* Keyed so the field shows the saved value after each change. */}
      <form
        key={allowance.storageQuotaOverrideBytes ?? "tier"}
        action={updateUserQuotaAction}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="userId" value={userId} />
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`quota-${userId}`}>
          Quota (MiB)
        </label>
        <Input
          id={`quota-${userId}`}
          type="number"
          name="quotaMb"
          min={0}
          step={1}
          defaultValue={custom ? Math.round(allowance.storageQuotaOverrideBytes! / MIB) : ""}
          placeholder={
            allowance.tierStorageQuotaBytes === null
              ? "From tier"
              : `${Math.round(allowance.tierStorageQuotaBytes / MIB)} (tier)`
          }
          className="h-9 w-32"
          aria-label="Storage quota in MiB; leave blank to use the tier's"
        />
        <Button type="submit" variant="outline" size="sm">
          Set quota
        </Button>
        {custom ? (
          <Button type="submit" name="reset" value="1" variant="ghost" size="sm" formNoValidate>
            <RotateCcw className="size-4" />
            Use tier quota
          </Button>
        ) : null}
      </form>
      <p className="text-xs text-muted-foreground">
        {custom
          ? `Custom quota. The ${tierLabel} tier gives ${tierQuota ?? "its default"}.`
          : `From the ${tierLabel} tier${tierQuota ? ` (${tierQuota})` : ""}. Enter a number to give this user their own.`}
      </p>
    </div>
  );
}
