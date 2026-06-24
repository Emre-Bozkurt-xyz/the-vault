import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  resetUserExtensionSettingsAction,
  setUserExtensionEnabledAction,
} from "@/server/user-settings-actions";
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
  mode?: "browser" | "installed";
};

export function ExtensionBrowserSection({
  extensions,
  userSettings,
  mode = "browser",
}: ExtensionBrowserSectionProps) {
  const userSettingsByExtension = new Map(
    userSettings.map((setting) => [setting.extensionId, setting]),
  );
  const visibleExtensions =
    mode === "installed"
      ? extensions.filter(
          (extension) =>
            userSettingsByExtension.get(extension.id)?.enabled ??
            extension.defaultEnabled ??
            false,
        )
      : extensions;

  if (visibleExtensions.length === 0) {
    return (
      <div className="border border-dashed border-border/70 bg-card/35 p-6">
        <p className="text-sm font-medium">No enabled extensions.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Enable a local built-in extension from the browser to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {visibleExtensions.map((extension) => {
        const setting = userSettingsByExtension.get(extension.id);
        const enabled = setting?.enabled ?? extension.defaultEnabled ?? false;
        const contributionLabels = getContributionLabels(extension);

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
                <Badge variant="outline">{extension.kind}</Badge>
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

              {extension.settings?.sections?.length ? (
                <div className="mt-4 border-t border-border/70 pt-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Settings
                  </p>
                  <div className="mt-2 grid gap-2">
                    {extension.settings.sections.flatMap((section) =>
                      section.fields.map((field) => (
                        <div
                          key={`${section.id}:${field.key}`}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <div>
                            <p className="font-medium">{field.label}</p>
                            {"description" in field && field.description ? (
                              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                {field.description}
                              </p>
                            ) : null}
                          </div>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {formatSettingValue(
                              setting?.settings?.[field.key] ??
                                extension.settings?.defaults?.[field.key],
                            )}
                          </code>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-start gap-2 md:justify-end">
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
              <form action={resetUserExtensionSettingsAction}>
                <input type="hidden" name="extensionId" value={extension.id} />
                <Button type="submit" variant="outline">
                  Reset
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

  return labels;
}

function formatSettingValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "on" : "off";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "default";
  }

  return "configured";
}
