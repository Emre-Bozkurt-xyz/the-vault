import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
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

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const workspace = await getWorkspaceData();

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: workspaceHistoryRestoreScript }}
        suppressHydrationWarning
      />
      <WorkspaceChrome workspace={workspace}>{children}</WorkspaceChrome>
    </>
  );
}
