import { ExtensionHostProvider } from "@/components/extensions/ExtensionHostProvider";
import { KeybindingsProvider } from "@/components/shortcuts/KeybindingsProvider";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { WorkspaceHistoryRestore } from "@/components/workspace/WorkspaceHistoryRestore";
import { resolveKeybindings } from "@/lib/shortcuts/resolve";
import { WorkspaceSettingsModalMount } from "@/components/settings/WorkspaceSettingsModalMount";
import { getCspNonce } from "@/lib/security/nonce";
import { resolveViewerExtensions } from "@/server/extension-runtime";
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
  // Memoized per request: the page below reuses this result, and its settings
  // read already produced the preferences this layout needs.
  const { preferences, ...workspace } = await getWorkspaceData();
  const viewerExtensions = await resolveViewerExtensions(workspace.profile.id);
  // The theme script runs before hydration, so it needs the request's CSP nonce.
  const nonce = await getCspNonce();

  return (
    <>
      <WorkspaceHistoryRestore />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: workspaceThemeScript(preferences.appearance.themeId),
        }}
        suppressHydrationWarning
      />
      <KeybindingsProvider
        bindings={resolveKeybindings(preferences.hotkeys.keybindings)}
        editorShortcutsEnabled={preferences.hotkeys.editorShortcutsEnabled}
      >
        <ExtensionHostProvider
          enabledIds={viewerExtensions.enabledIds}
          settings={viewerExtensions.settings}
        >
          <WorkspaceChrome workspace={workspace}>{children}</WorkspaceChrome>
          <WorkspaceSettingsModalMount />
        </ExtensionHostProvider>
      </KeybindingsProvider>
    </>
  );
}
