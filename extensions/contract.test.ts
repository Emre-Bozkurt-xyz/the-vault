/**
 * The extension contract (`docs/23_EXTENSION_SDK_PLAN.md` §18.4): checks every
 * registered extension with no per-extension code, so a new folder is covered
 * the moment it exists. Grows with each slice.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertManifest } from "@/lib/extension-api";
import { parseFixtureState } from "@/lib/extension-host/fixtures";
import { toVaultExtension } from "@/lib/extension-host/compat";
import { createVaultExtensionRegistry } from "@/lib/extensions/registry";
import {
  scanExtensions,
  staleRegistryFiles,
} from "../scripts/generate-extension-registry.mjs";

import { extensionManifests } from "./manifests";
import { clientExtensions } from "./registry.client";
import { renderModules } from "./registry.render";
import { serverExtensions } from "./registry.server";

const extensionsDir = path.dirname(new URL(import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

describe("extension registry files", () => {
  it("are up to date with the extension folders", () => {
    expect(staleRegistryFiles(extensionsDir)).toEqual([]);
  });

  it("list the same extensions in the same order", () => {
    const ids = extensionManifests.map((manifest) => manifest.id);

    expect(clientExtensions.map((entry) => entry.manifest.id)).toEqual(ids);
    expect(serverExtensions.map((entry) => entry.manifest.id)).toEqual(ids);
  });

  it("never let the client registry reach a server module", () => {
    const source = fs.readFileSync(
      path.join(extensionsDir, "registry.client.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/\/server["']/);
    // Editor modules only ever through import(), so each stays its own lazily
    // loaded chunk.
    expect(source).not.toMatch(/^import \w+ from "\.\/[^"]+\/editor"/m);
  });
});

/** Relative files a module imports statically (not through `import()`). */
function staticRelativeImports(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = [
    ...source.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s+["'](\.[^"']+)["']/gm),
  ]
    .filter((match) => !/^\s*import\s+type\b/.test(match[0]))
    .map((match) => match[1]);

  return specifiers.flatMap((specifier) => {
    const base = path.resolve(path.dirname(file), specifier);
    const resolved = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
      .map((suffix) => base + suffix)
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return resolved ? [resolved] : [];
  });
}

function isClientModule(file: string): boolean {
  const firstStatement = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("//"));
  return firstStatement === '"use client";' || firstStatement === "'use client';";
}

describe("every extension", () => {
  const folders = scanExtensions(extensionsDir);

  it("has unique ids", () => {
    const ids = extensionManifests.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique syntax claims", () => {
    const claims = extensionManifests.flatMap((manifest) => [
      // Leaf and container directives share one namespace: both are `:::name`.
      ...(manifest.syntax?.blocks ?? []).map((name) => `block:${name}`),
      ...(manifest.syntax?.containers ?? []).map((name) => `block:${name}`),
      ...(manifest.syntax?.inline ?? []).map((name) => `inline:${name}`),
      ...(manifest.syntax?.fences ?? []).map((name) => `fence:${name}`),
    ]);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it("builds a valid registry with its server module", () => {
    expect(() =>
      createVaultExtensionRegistry(
        serverExtensions.map(({ manifest, server }) =>
          toVaultExtension(manifest, server),
        ),
      ),
    ).not.toThrow();
  });

  for (const [index, manifest] of extensionManifests.entries()) {
    describe(manifest.id, () => {
      it("is named after its folder", () => {
        expect(manifest.id).toBe(`vault.${folders[index].folder}`);
      });

      it("passes the manifest invariants", () => {
        expect(() => assertManifest(manifest)).not.toThrow();
      });

      it("pairs with its own server module", () => {
        const server = serverExtensions[index].server;
        if (server) {
          expect(server.manifestId).toBe(manifest.id);
        }
      });

      it("only lets slash items run commands the manifest declares or the host provides", () => {
        const declared = new Set((manifest.commands ?? []).map((command) => command.id));
        for (const slash of manifest.slashCommands ?? []) {
          if (slash.run) {
            expect(slash.run.command.startsWith(`${manifest.id}.`)).toBe(true);
            // One of this extension's commands, run by its editor module.
            expect(declared).toContain(slash.run.command);
          }
        }
      });

      const folder = folders[index];
      const renderFile = ["render.tsx", "render.ts"]
        .map((name) => path.join(extensionsDir, folder.folder, name))
        .find((file) => fs.existsSync(file));

      if (renderFile) {
        // Server pages bundle every client component they statically reference
        // into their entry chunk (plan §14 slice 0), so a render module must
        // reach its components only through `load: () => import(...)`.
        it("never statically imports a client component into its render module", () => {
          const offenders = staticRelativeImports(renderFile)
            .filter(isClientModule)
            .map((file) => path.relative(extensionsDir, file));
          expect(offenders).toEqual([]);
        });

        it("has a render module registered for it", () => {
          expect(renderModules.map((module) => module.manifestId)).toContain(manifest.id);
        });
      }

      // Rendering follows content: a declared overlay needs a read-only
      // renderer for readers, whatever editors get.
      it("renders every overlay it declares", () => {
        const rendered = new Set(
          Object.keys(
            renderModules.find((module) => module.manifestId === manifest.id)?.overlays ?? {},
          ),
        );
        for (const overlay of manifest.overlays ?? []) {
          expect(rendered).toContain(overlay.id);
        }
      });

      // A claimed block without a component would render as its fallback
      // forever: the host has nothing to load.
      it("renders every block it claims", () => {
        const rendered = new Set(
          Object.keys(
            renderModules.find((module) => module.manifestId === manifest.id)?.blocks ?? {},
          ),
        );
        for (const name of manifest.syntax?.blocks ?? []) {
          expect(rendered).toContain(name);
        }
      });

      // Fixtures feed the playground (plan §18.3); a broken one should fail
      // here, not there.
      const fixturesDir = path.join(extensionsDir, folder.folder, "fixtures");
      if (fs.existsSync(fixturesDir)) {
        it("has fixture state that matches its declared state schemas", () => {
          const declarations = serverExtensions[index].server?.state ?? [];
          for (const file of fs.readdirSync(fixturesDir)) {
            if (!file.endsWith(".state.json")) continue;
            expect(
              fs.existsSync(path.join(fixturesDir, file.replace(/\.state\.json$/, ".md"))),
              `${file} has no matching .md fixture`,
            ).toBe(true);

            const rows = parseFixtureState(
              fs.readFileSync(path.join(fixturesDir, file), "utf8"),
            );
            for (const [stateKey, row] of Object.entries(rows)) {
              const declaration =
                declarations.find((candidate) => candidate.key === stateKey) ??
                declarations.find((candidate) => candidate.key === undefined);
              expect(declaration, `${file}: no state schema covers "${stateKey}"`).toBeDefined();
              const parsed = declaration!.schema.safeParse(row.state);
              expect(parsed.success, `${file}: "${stateKey}" ${parsed.error?.message ?? ""}`).toBe(true);
            }
          }
        });
      }

      const client = clientExtensions[index];
      if (client.editor) {
        it("handles every command its manifest declares, in its editor module", async () => {
          const editor = (await client.editor!()).default;
          expect(editor.manifestId).toBe(manifest.id);
          expect(Object.keys(editor.commands).sort()).toEqual(
            (manifest.commands ?? []).map((command) => command.id).sort(),
          );
          for (const item of editor.toolbar) {
            expect(Object.keys(editor.commands)).toContain(item.command);
          }
          const declaredOverlays = (manifest.overlays ?? []).map((overlay) => overlay.id);
          for (const overlayId of Object.keys(editor.overlays)) {
            expect(declaredOverlays).toContain(overlayId);
          }
        });
      }

      if (manifest.settings) {
        const settings = manifest.settings;

        it("declares defaults equal to what its schema parses from nothing", () => {
          const parsed = settings.schema.parse({});
          if (settings.defaults) {
            expect(parsed).toEqual(settings.defaults);
          }
        });

        it("shows a field only for keys the schema has", () => {
          const keys = Object.keys(settings.schema.parse({}));
          for (const section of settings.sections ?? []) {
            for (const field of section.fields) {
              expect(keys).toContain(field.key);
            }
          }
        });
      }
    });
  }
});
