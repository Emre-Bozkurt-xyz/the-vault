import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AssetBinClient } from "@/components/assets/AssetBinClient";
import { AssetLibraryClient } from "@/components/assets/AssetLibraryClient";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { parseMediaLibraryPrefs } from "@/lib/media-library";
import {
  listBinFoldersForUser,
  listFoldersForUser,
} from "@/server/asset-folders";
import {
  getUserStorageSummary,
  listAssetsForUser,
  listBinAssetsForUser,
} from "@/server/assets";
import { listSharedTargetsForUser } from "@/server/asset-share-links";
import { getUserSetting } from "@/server/user-settings";

type AssetsPageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { view } = await searchParams;

  if (view === "bin") {
    const [binAssets, binFolders] = await Promise.all([
      listBinAssetsForUser(session.user.id),
      listBinFoldersForUser(session.user.id),
    ]);

    return (
      <WorkspacePage width="full" className="max-w-[96rem]">
        <AssetBinClient initialAssets={binAssets} initialFolders={binFolders} />
      </WorkspacePage>
    );
  }

  const [assets, folders, storage, viewSetting, shared] = await Promise.all([
    listAssetsForUser(session.user.id),
    listFoldersForUser(session.user.id),
    getUserStorageSummary(session.user.id),
    getUserSetting({ userId: session.user.id, namespace: "files-assets", key: "media-library" }),
    listSharedTargetsForUser(session.user.id),
  ]);

  return (
    <>
      {/* AssetLibraryClient registers the page itself: it owns the right panel. */}
      <WorkspacePage width="full" className="max-w-[96rem]">
        <AssetLibraryClient
          initialAssets={assets}
          initialFolders={folders}
          initialPrefs={parseMediaLibraryPrefs(viewSetting?.value)}
          initialShared={shared}
          storageUsedBytes={storage.usedBytes}
          storageQuotaBytes={storage.quotaBytes}
          unrestrictedUploads={storage.unrestrictedUploadsAllowed}
        />
      </WorkspacePage>
    </>
  );
}
