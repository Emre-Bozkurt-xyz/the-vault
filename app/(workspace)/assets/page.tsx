import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AssetLibraryClient } from "@/components/assets/AssetLibraryClient";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { getUserStorageSummary, listAssetsForUser } from "@/server/assets";

export default async function AssetsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [assets, storage] = await Promise.all([
    listAssetsForUser(session.user.id),
    getUserStorageSummary(session.user.id),
  ]);

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "assets", title: "Assets", href: "/assets" }}
      />
      <section className="mx-auto w-full max-w-6xl py-6">
        <AssetLibraryClient
          initialAssets={assets}
          storageQuotaBytes={storage.quotaBytes}
        />
      </section>
    </>
  );
}
