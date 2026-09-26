import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { parseFixtureState, type ExtensionFixture } from "@/lib/extension-host/fixtures";

/** First-party extension folders are named after the id's second half. */
export function extensionFolder(extensionId: string): string {
  return extensionId.slice(extensionId.indexOf(".") + 1);
}

/**
 * Reads an installed extension's fixtures from disk. Development only: the
 * caller must have checked that `extensionId` is installed, which is also what
 * keeps the path inside `extensions/`.
 */
export async function readExtensionFixtures(
  extensionId: string,
  root: string = process.cwd(),
): Promise<ExtensionFixture[]> {
  const dir = path.join(root, "extensions", extensionFolder(extensionId), "fixtures");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const fixtures: ExtensionFixture[] = [];
  for (const file of entries.filter((entry) => entry.endsWith(".md")).sort()) {
    const name = file.slice(0, -".md".length);
    const markdown = await fs.readFile(path.join(dir, file), "utf8");
    let state = {};
    try {
      state = parseFixtureState(
        await fs.readFile(path.join(dir, `${name}.state.json`), "utf8"),
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    fixtures.push({ name, markdown, state });
  }
  return fixtures;
}
