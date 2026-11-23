import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AssetBinClient } from "@/components/assets/AssetBinClient";
import { AssetLibraryClient } from "@/components/assets/AssetLibraryClient";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import {
  getUserStorageSummary,
  listAssetsForUser,
  listBinAssetsForUser,
} from "@/server/assets";

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
    const binAssets = await listBinAssetsForUser(session.user.id);

    return (
      <WorkspacePage width="full" className="max-w-[96rem]">
        <AssetBinClient initialAssets={binAssets} />
      </WorkspacePage>
    );
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
