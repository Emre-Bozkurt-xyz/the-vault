import { buildSettingsPages } from "@/components/settings/buildSettingsPages";
import { SettingsModalController } from "@/components/settings/SettingsModalController";

type WorkspaceSettingsModalMountProps = {
  profile: {
    id: string;
    email: string | null;
    image: string | null;
    nickname: string | null;
    username: string | null;
  };
};

export async function WorkspaceSettingsModalMount({
  profile,
}: WorkspaceSettingsModalMountProps) {
  const pages = await buildSettingsPages({ profile });

  return <SettingsModalController pages={pages} />;
}
