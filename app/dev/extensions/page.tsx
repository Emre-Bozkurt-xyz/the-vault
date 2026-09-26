import Link from "next/link";
import { notFound } from "next/navigation";

import { extensionManifests } from "@/extensions/manifests";
import { clientExtensions } from "@/extensions/registry.client";
import { renderModules } from "@/extensions/registry.render";
import { serverExtensions } from "@/extensions/registry.server";
import { readExtensionFixtures } from "@/lib/extension-host/fixtures.server";

export const dynamic = "force-dynamic";

/**
 * Development-only index of installed extensions
 * (`docs/23_EXTENSION_SDK_PLAN.md` §18.3). A 404 in production.
 */
export default async function ExtensionsIndexPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const rows = await Promise.all(
    extensionManifests.map(async (manifest) => ({
      manifest,
      render: renderModules.some((module) => module.manifestId === manifest.id),
      editor: Boolean(
        clientExtensions.find((entry) => entry.manifest.id === manifest.id)?.editor,
      ),
      server: Boolean(
        serverExtensions.find((entry) => entry.manifest.id === manifest.id)?.server,
      ),
      fixtures: (await readExtensionFixtures(manifest.id)).length,
    })),
  );

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Extension playground</h1>
        <p className="text-sm text-muted-foreground">
          Development only. Each extension&apos;s fixtures rendered live, read, public and
          disabled, from in-memory state. Add fixtures under{" "}
          <code>extensions/&lt;name&gt;/fixtures/</code>.
        </p>
      </header>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2">Extension</th>
            <th>Modules</th>
            <th>Syntax</th>
            <th>Commands</th>
            <th>Fixtures</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ manifest, render, editor, server, fixtures }) => (
            <tr key={manifest.id} className="border-t border-border/50">
              <td className="py-2">
                <Link className="font-medium underline-offset-4 hover:underline" href={`/dev/extensions/${manifest.id}`}>
                  {manifest.name}
                </Link>
                <div className="font-mono text-xs text-muted-foreground">{manifest.id}</div>
              </td>
              <td className="font-mono text-xs">
                {[render && "render", editor && "editor", server && "server"].filter(Boolean).join(" · ") ||
                  "manifest only"}
              </td>
              <td className="font-mono text-xs">
                {[
                  ...(manifest.syntax?.blocks ?? []).map((name) => `:::${name}`),
                  ...(manifest.syntax?.containers ?? []).map((name) => `:::${name} …`),
                  ...(manifest.syntax?.inline ?? []).map((name) => `:${name}[]`),
                  ...(manifest.syntax?.fences ?? []).map((name) => `\`\`\`${name}`),
                ].join(" ") || "none"}
              </td>
              <td>{manifest.commands?.length ?? 0}</td>
              <td>{fixtures}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
