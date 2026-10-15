import { randomUUID } from "node:crypto";

import { SettingsModalController } from "@/components/settings/SettingsModalController";

/**
 * Mounts the workspace settings modal without building it: pages load through
 * `loadWorkspaceSettingsPagesAction` when the modal first opens.
 *
 * `revision` changes whenever the workspace layout renders again (a full load,
 * `router.refresh()`, or a server action's `revalidatePath`), which is when the
 * pages used to be rebuilt; the controller reloads them on that signal so a
 * setting saved from inside the modal still reaches every page.
 */
export function WorkspaceSettingsModalMount() {
  return <SettingsModalController revision={randomUUID()} />;
}
