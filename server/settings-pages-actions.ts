"use server";

import { loadSettingsData } from "@/components/settings/loadSettingsData";
import type { SettingsData } from "@/components/settings/settings-data";
import { requireCompletedProfile } from "@/server/profile";

/**
 * The workspace settings modal's data, loaded when the modal opens rather than
 * on every workspace layout render (the modal starts closed, and the data means
 * reading auth providers, extension settings, preferences and snippets). Plain
 * data, not rendered pages: the client builds those (`settings-pages-view`).
 * The acting user comes from the session, never from the client.
 */
export async function loadWorkspaceSettingsDataAction(): Promise<SettingsData> {
  const profile = await requireCompletedProfile();

  return loadSettingsData({
    profile: {
      id: profile.id,
      email: profile.email,
      image: profile.image,
      nickname: profile.nickname,
      username: profile.username,
    },
  });
}
