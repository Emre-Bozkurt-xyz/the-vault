import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SharedMediaGallery } from "@/components/share/SharedMediaGallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { checkRateLimit } from "@/lib/rate-limit";
import { cn } from "@/lib/utils";
import {
  getSharedSingleAsset,
  listSharedFolder,
  resolveShareToken,
  touchShareLink,
} from "@/server/asset-share-links";

type SharedPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ f?: string | string[] }>;
};

// Always rendered per request: a link can be turned off at any moment.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: SharedPageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await resolveShareToken(token);
  const title = share?.folder?.name ?? "Shared file";
  return {
    title: share ? `${title} · Shared on Vault` : "Shared on Vault",
    description: share ? `Shared by ${share.ownerName}.` : undefined,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/s/<token>`: a media share link (docs/26 §9) for someone who may never have
 * heard of Vault. A folder link browses its live subtree (`?f=` for subfolders,
 * only inside it); a file link shows that one file. Anything not working —
 * forged, revoked, expired, binned — is the same 404.
 */
export default async function SharedMediaPage({ params, searchParams }: SharedPageProps) {
  const [{ token }, { f }] = await Promise.all([params, searchParams]);
  const requestHeaders = await headers();
  const address =
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!checkRateLimit(`share-page:${address}`, 120, 60_000).ok) {
    return (
      <SharedShell>
        <p className="py-24 text-center text-sm text-muted-foreground">
          Too many requests. Try again in a minute.
        </p>
      </SharedShell>
    );
  }

  const share = await resolveShareToken(token);
  if (!share) notFound();
  void touchShareLink(share.link.id).catch(() => undefined);
  const base = `/s/${token}`;

  if (!share.folder) {
    const asset = await getSharedSingleAsset(share, token);
    if (!asset) notFound();
    return (
      <SharedShell>
        <SharedMediaGallery
          title={asset.displayName}
          sharedBy={share.ownerName}
          path={[{ name: asset.displayName, href: base }]}
          folders={[]}
          assets={[asset]}
          allowDownload={share.link.allowDownload}
          zipHref={null}
          singleItem
        />
      </SharedShell>
    );
  }

  const folderId = typeof f === "string" && f ? f : share.folder.id;
  const listing = await listSharedFolder(share, token, folderId);
  if (!listing) notFound();
  const here = listing.path.at(-1)!;

  return (
    <SharedShell>
      <SharedMediaGallery
        title={here.name}
        sharedBy={share.ownerName}
        path={listing.path.map((crumb, index) => ({
          name: crumb.name,
          href: index === 0 ? base : `${base}?f=${crumb.id}`,
        }))}
        folders={listing.folders.map((folder) => ({ ...folder, href: `${base}?f=${folder.id}` }))}
        assets={listing.assets}
        allowDownload={share.link.allowDownload}
        zipHref={`${base}/zip${folderId === share.folder.id ? "" : `?f=${folderId}`}`}
      />
    </SharedShell>
  );
}

function SharedShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 sm:py-10">
        <header className="mb-8 flex items-center justify-between gap-3 border-b border-border/50 pb-4">
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Vault
          </Link>
          <ThemeToggle />
        </header>
        {children}
      </div>
    </main>
  );
}
