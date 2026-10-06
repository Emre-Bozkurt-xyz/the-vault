/**
 * Scaffolds a new first-party extension (`docs/23_EXTENSION_SDK_PLAN.md` §18.1):
 *
 *   npm run ext:new -- <name> [--render] [--editor] [--server]
 *
 * With no flags, all three modules are created. The result passes the contract
 * test, the type check and lint as generated, so an author starts from green
 * and replaces the TODOs. The registries are regenerated at the end.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith("--"));
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const all = !["--render", "--editor", "--server"].some((flag) => flags.has(flag));
const want = {
  render: all || flags.has("--render"),
  editor: all || flags.has("--editor"),
  server: all || flags.has("--server"),
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  fail("Usage: npm run ext:new -- <name> [--render] [--editor] [--server]\n<name> is lowercase letters, digits and hyphens, starting with a letter.");
}

const dir = path.join(root, "extensions", name);
if (fs.existsSync(dir)) fail(`extensions/${name} already exists.`);

const id = `vault.${name}`;
const title = name
  .split("-")
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(" ");
const pascal = title.replace(/ /g, "");

const files = {};

files["manifest.ts"] = `import { defineManifest } from "@/lib/extension-api";

export default defineManifest({
  id: "${id}",
  name: "${title}",
  version: 1,
  category: "editor",
  // TODO: one sentence, shown in Settings → Extensions.
  description: "${title}.",
  defaultEnabled: false,
  permissions: [],${want.render ? `
  // Directives this extension owns. Readers get the block whether or not they
  // enabled the extension: rendering follows content (plan §3).
  syntax: { blocks: ["${name}"] },` : ""}${want.editor ? `
  commands: [{ id: "${id}.insert", label: "Insert ${title.toLowerCase()}" }],
  slashCommands: [
    {
      id: "${id}.slash",
      label: "${name}",
      title: "${title}",${want.render ? `
      directive: "${name}",` : ""}
      run: { command: "${id}.insert" },
    },
  ],` : ""}
});
`;

if (want.render) {
  files["render.tsx"] = `import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  blocks: {
    // Components load lazily; never import one statically here.
    ${JSON.stringify(name)}: {
      form: "leaf",
      live: "widget",
      load: () => import("./${pascal}Block"),
    },
  },
});
`;

  files[`${pascal}Block.tsx`] = `"use client";

import type { BlockProps } from "@/lib/extension-api";

/**
 * \`:::${name}{…}\`, rendered in Read mode, on public pages and as the
 * Live-mode widget. \`ctx\` says where (surface, canEdit, settings, state).
 */
export default function ${pascal}Block({ ctx, attributes }: BlockProps) {
  // TODO: render the block.
  return (
    <div className="vault-extension-block-fallback">
      <code>${name}</code> {ctx.canEdit ? "(editable)" : null}{" "}
      {Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null}
    </div>
  );
}
`;
}

// One fixture, so the extension shows up in the playground straight away.
files["fixtures/basic.md"] = `# ${title}

${want.render ? `A block rendered by this extension:

:::${name}{id=demo}
` : "TODO: a document that exercises this extension."}`;

if (want.editor) {
  const inserted = want.render ? `:::${name}` : title;
  files["editor.tsx"] = `import { Puzzle } from "lucide-react";

import { defineEditor } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineEditor(manifest, {
  commands: {
    // TODO: what inserting this extension does.
    "${id}.insert": (editor) => editor.insertBlock(${JSON.stringify(inserted)}),
  },
  toolbar: [{ command: "${id}.insert", label: "Insert ${title.toLowerCase()}", icon: Puzzle }],
});
`;

  files["editor.test.ts"] = `import { describe, expect, it } from "vitest";

import { runCommand } from "@/lib/extension-api/testing";

import editor from "./editor";

describe("${id} editor", () => {
  it("inserts on its own line", async () => {
    const result = await runCommand(editor, "${id}.insert", "Text|");
    expect(result.markdown).toBe(${JSON.stringify(`Text\n\n${inserted}\n`)});
  });
});
`;
}

if (want.server) {
  files["server.ts"] = `import "server-only";

import { defineServer } from "@/lib/extension-api/server";

import manifest from "./manifest";

export default defineServer(manifest, {
  // Agent actions (and, with \`agent: false\`, actions only this extension's
  // UI calls) and state schemas go here. Handlers get everything through
  // their context; they never import \`db\` (plan §8).
  actions: [],
});
`;
}

for (const [file, contents] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), contents);
  console.log(`created extensions/${name}/${file}`);
}

execFileSync(process.execPath, [path.join(root, "scripts", "generate-extension-registry.mjs")], {
  stdio: "inherit",
});

console.log(`
Next:
  - read extensions/README.md, replace the TODOs, then \`npm test -- extensions\`
  - see it at /dev/extensions/${id} (npm run dev), fixtures in extensions/${name}/fixtures/
  - style it in app/styles and follow docs/CSS_CONTRACT.md`);
