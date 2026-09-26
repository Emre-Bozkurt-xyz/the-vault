import Link from "next/link";
import { notFound } from "next/navigation";

import { ExtensionPlayground } from "@/components/extensions/playground/ExtensionPlayground";
import { extensionManifests } from "@/extensions/manifests";
import { readExtensionFixtures } from "@/lib/extension-host/fixtures.server";

export const dynamic = "force-dynamic";

/**
 * Development-only playground for one extension
 * (`docs/23_EXTENSION_SDK_PLAN.md` §18.3). A 404 in production.
 */
export default async function ExtensionPlaygroundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { id } = await params;
  const extensionId = decodeURIComponent(id);
  // Only installed ids: this is also what keeps the fixture path in `extensions/`.
  const manifest = extensionManifests.find((candidate) => candidate.id === extensionId);
  if (!manifest) {
    notFound();
  }

  const fixtures = await readExtensionFixtures(manifest.id);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <Link href="/dev/extensions" className="text-xs text-muted-foreground hover:text-foreground">
          ← All extensions
        </Link>
        <h1 className="text-2xl font-semibold">{manifest.name}</h1>
        <p className="text-sm text-muted-foreground">{manifest.description}</p>
      </header>
      <ExtensionPlayground extensionId={manifest.id} fixtures={fixtures} />
    </main>
  );
}
