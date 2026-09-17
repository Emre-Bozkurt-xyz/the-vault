import { OpenExtensionSettingsButton } from "@/components/settings/OpenExtensionSettingsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setUserExtensionEnabledAction } from "@/server/user-settings-actions";
import type { VaultExtension } from "@/lib/extensions/types";

type UserExtensionSettingRecord = {
  extensionId: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  version: number;
};

type ExtensionBrowserSectionProps = {
  extensions: VaultExtension[];
  userSettings: UserExtensionSettingRecord[];
};

/**
 * The single Extensions page: every built-in extension, with enable/disable.
 *
 * This used to be two pages — a browser and an "installed" filter of the same
 * list. Settings are no longer previewed here either: each enabled extension that
 * declares settings gets its own page in the Extensions group, and "Settings"
 * jumps straight to it.
 */
export function ExtensionBrowserSection({
  extensions,
  userSettings,
}: ExtensionBrowserSectionProps) {
  const userSettingsByExtension = new Map(
    userSettings.map((setting) => [setting.extensionId, setting]),
  );

  return (
    <div className="grid gap-3">
      {extensions.map((extension) => {
        const setting = userSettingsByExtension.get(extension.id);
        const enabled = setting?.enabled ?? extension.defaultEnabled ?? false;
        const contributionLabels = getContributionLabels(extension);
        const hasSettings = Boolean(extension.settings?.sections?.length);

        return (
          <article
            key={extension.id}
            className="grid gap-4 border border-border/70 bg-card/35 p-4 md:grid-cols-[1fr_auto]"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{extension.name}</h3>
                <Badge variant={enabled ? "default" : "outline"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
                {extension.category ? (
                  <Badge variant="secondary">{extension.category}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {extension.id} · v{extension.version}
              </p>
              {extension.description ? (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {extension.description}
                </p>
              ) : null}

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <MetadataList
                  label="Permissions"
                  items={extension.permissions ?? ["No special permissions"]}
                />
                <MetadataList
                  label="Contributes"
                  items={
                    contributionLabels.length
                      ? contributionLabels
                      : ["Metadata only"]
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-2 md:justify-end">
              {enabled && hasSettings ? (
                <OpenExtensionSettingsButton extensionId={extension.id} />
              ) : null}
              <form action={setUserExtensionEnabledAction}>
                <input type="hidden" name="extensionId" value={extension.id} />
                <input
                  type="hidden"
                  name="enabled"
                  value={enabled ? "false" : "true"}
                />
                <Button type="submit" variant={enabled ? "outline" : "default"}>
                  {enabled ? "Disable" : "Enable"}
                </Button>
              </form>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MetadataList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant="outline">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function getContributionLabels(extension: VaultExtension) {
  const labels: string[] = [];

  if (extension.markdown?.slashCommands?.length) {
    labels.push("Slash commands");
  }

  if (extension.markdown?.liveBlocks?.length) {
    labels.push("Markdown live blocks");
  }

  if (extension.documentState?.overlays?.length) {
    labels.push("Document overlay");
  }

  if (extension.workspace?.pages?.length) {
    labels.push("Workspace page");
  }

  if (extension.workspace?.panels?.length) {
    labels.push("Workspace panel");
  }

  if (extension.workspace?.commands?.length) {
    labels.push("Commands");
  }

  if (extension.agent?.actions.length) {
    labels.push("Agent actions");
  }

  return labels;
}
