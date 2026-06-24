import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { buildPreferences } from "@/lib/settings/preferences";
import { WorkspaceSettingsModalMount } from "@/components/settings/WorkspaceSettingsModalMount";
import { listUserSettings } from "@/server/user-settings";
import { getWorkspaceData } from "@/server/workspace";
import type { ReactNode } from "react";

const workspaceHistoryRestoreScript = String.raw`
(() => {
  const restoreKey = "vault.workspace.historyRestoreReload.v1";
  const debugKey = "vault.debug.historyRestore";
  const markerKey = "__vaultWorkspaceHistoryRestoreGuardInstalled";

  if (window[markerKey]) {
    return;
  }

  window[markerKey] = true;

  function navigationType() {
    const navigation = performance.getEntriesByType("navigation")[0];
    return navigation && navigation.type ? navigation.type : "unknown";
  }

  function debug(message, extra) {
    if (localStorage.getItem(debugKey) !== "true") {
      return;
    }

    console.info("[Vault history restore]", message, {
      href: location.href,
      navigationType: navigationType(),
      restoreKey: sessionStorage.getItem(restoreKey),
      ...(extra || {}),
    });
  }

  function maybeReload(reason, persisted) {
    const type = navigationType();
    const shouldReload = Boolean(persisted) || type === "back_forward";

    debug("check", { reason, persisted: Boolean(persisted), shouldReload });

    if (!shouldReload) {
      sessionStorage.removeItem(restoreKey);
      return;
    }

    if (sessionStorage.getItem(restoreKey) === location.href) {
      debug("skip reload; href already reloaded", { reason, persisted: Boolean(persisted) });
      return;
    }

    sessionStorage.setItem(restoreKey, location.href);
    debug("reload", { reason, persisted: Boolean(persisted) });
    location.reload();
  }

  addEventListener("pageshow", (event) => {
    maybeReload("pageshow", event.persisted);
  });

  maybeReload("inline");
})();
`;

function workspaceThemeScript(themeId: string) {
  return `
(() => {
  const theme = ${JSON.stringify(themeId)};
  const allowed = new Set(["dark", "light", "midnight", "graphite", "paper", "system"]);
  const nextTheme = allowed.has(theme) ? theme : "dark";
  const effective = nextTheme === "system"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : nextTheme;
  const dark = effective === "dark" || effective === "midnight" || effective === "graphite";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem("theme", nextTheme);
})();
`;
}

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const workspace = await getWorkspaceData();
  const userSettings = await listUserSettings({ userId: workspace.profile.id });
  const preferences = buildPreferences(userSettings);

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: workspaceHistoryRestoreScript }}
        suppressHydrationWarning
      />
      <script
        dangerouslySetInnerHTML={{
          __html: workspaceThemeScript(preferences.appearance.themeId),
        }}
        suppressHydrationWarning
      />
      <WorkspaceChrome workspace={workspace}>{children}</WorkspaceChrome>
      <WorkspaceSettingsModalMount profile={workspace.profile} />
    </>
  );
}
