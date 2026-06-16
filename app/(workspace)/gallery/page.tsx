import { Search } from "lucide-react";

import { PublicAssetGallery } from "@/components/assets/PublicAssetGallery";
import { Button } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { WorkspaceDocumentPreviewCard } from "@/components/workspace/WorkspaceDocumentPreviewCard";
import { listPublicAssets } from "@/server/assets";
import { getWorkspaceData } from "@/server/workspace";

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [workspace, publicAssets] = await Promise.all([
    getWorkspaceData(),
    listPublicAssets(),
  ]);
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const normalizedQuery = query.toLowerCase().replace(/^@/, "");
  const publicDocuments = normalizedQuery
    ? workspace.publicDocuments.filter((document) =>
        [
          document.title,
          document.ownerName,
          document.ownerUsername,
          document.publicSlug,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery)),
      )
    : workspace.publicDocuments;
  const visibleAssets = normalizedQuery
    ? publicAssets.filter((asset) =>
        [
          asset.displayName,
          asset.description,
          asset.ownerName,
          asset.ownerUsername,
          asset.mimeType,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery)),
      )
    : publicAssets;

  return (
    <>
      <WorkspacePageRegistration
        page={{ type: "gallery", title: "Gallery", href: "/gallery" }}
      />
      <section className="mx-auto w-full max-w-5xl py-6">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
              Public content
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight vault-display">
              Gallery
            </h1>
          </div>
          <form
            action="/gallery"
            className="flex min-w-[min(100%,22rem)] items-center gap-2"
          >
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                defaultValue={query}
                type="search"
                placeholder="Title or @user"
                autoComplete="off"
                className="h-9 w-full border border-border/70 bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary/60"
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
        </div>

        <div className="mt-6 grid gap-6">
          {publicDocuments.length > 0 || visibleAssets.length > 0 ? (
            <PublicAssetGallery assets={visibleAssets}>
              {publicDocuments.map((document) => (
                <WorkspaceDocumentPreviewCard
                  key={document.id}
                  href={document.href}
                  title={document.title}
                  markdown={document.markdown}
                  meta={`@${document.ownerUsername ?? "unknown"} - ${document.updatedAt.toLocaleDateString()}`}
                />
              ))}
            </PublicAssetGallery>
          ) : (
            <p className="rounded-md border border-border/70 px-3 py-6 text-sm text-muted-foreground">
              {query
                ? `No public documents match "${query}".`
                : "No public documents yet."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
