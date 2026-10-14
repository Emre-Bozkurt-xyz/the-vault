import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AssetLibraryClient } from "@/components/assets/AssetLibraryClient";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
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
      {/* AssetLibraryClient registers the page itself: it owns the right panel. */}
      <WorkspacePage width="full" className="max-w-[96rem]">
        <AssetLibraryClient
          initialAssets={assets}
          storageQuotaBytes={storage.quotaBytes}
          unrestrictedUploads={storage.unrestrictedUploadsAllowed}
        />
      </WorkspacePage>
    </>
  );
}
