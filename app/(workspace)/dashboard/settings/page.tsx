import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadSettingsData } from "@/components/settings/loadSettingsData";
import { SettingsModalFromData } from "@/components/settings/settings-pages-view";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { requireCompletedProfile } from "@/server/profile";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; saved?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await requireCompletedProfile();
  const { connected, error, saved } = await searchParams;
  const data = await loadSettingsData({
    profile: {
      id: profile.id,
      email: profile.email,
      image: profile.image,
      nickname: profile.nickname,
      username: profile.username,
    },
    accountNotice: { connected, error, saved },
  });

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "settings", title: "Settings", href: "/dashboard/settings" }}
      />
      <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center text-sm text-muted-foreground">
        Settings are open.
      </div>
      <SettingsModalFromData data={data} defaultPageId="account" closeHref="/workspace" />
    </>
  );
}
