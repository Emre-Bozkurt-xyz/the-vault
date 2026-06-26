import { KeybindingsProvider } from "@/components/shortcuts/KeybindingsProvider";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { WorkspaceHistoryRestore } from "@/components/workspace/WorkspaceHistoryRestore";
import { buildPreferences } from "@/lib/settings/preferences";
import { resolveKeybindings } from "@/lib/shortcuts/resolve";
import { WorkspaceSettingsModalMount } from "@/components/settings/WorkspaceSettingsModalMount";
import { listUserSettings } from "@/server/user-settings";
import { getWorkspaceData } from "@/server/workspace";
import type { ReactNode } from "react";

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
      <WorkspaceHistoryRestore />
      <script
        dangerouslySetInnerHTML={{
          __html: workspaceThemeScript(preferences.appearance.themeId),
        }}
        suppressHydrationWarning
      />
      <KeybindingsProvider
        bindings={resolveKeybindings(preferences.hotkeys.keybindings)}
        editorShortcutsEnabled={preferences.hotkeys.editorShortcutsEnabled}
      >
        <WorkspaceChrome workspace={workspace}>{children}</WorkspaceChrome>
        <WorkspaceSettingsModalMount profile={workspace.profile} />
      </KeybindingsProvider>
    </>
  );
}
