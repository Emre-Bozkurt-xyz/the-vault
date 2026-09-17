"use client";

import { Button } from "@/components/ui/button";
import { useSettingsNavigation } from "@/components/settings/settings-navigation";
import { extensionSettingsPageId } from "@/components/settings/settings-pages";

/** Moves the settings modal to an extension's own page. */
export function OpenExtensionSettingsButton({
  extensionId,
}: {
  extensionId: string;
}) {
  const goTo = useSettingsNavigation();

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => goTo(extensionSettingsPageId(extensionId))}
    >
      Settings
    </Button>
  );
}
