import { describe, expect, it } from "vitest";

import type { ClientExtensionEntry } from "@/extensions/registry.client";
import type { EditorModule, ExtensionManifest } from "@/lib/extension-api";
import { selectEditorModulesToLoad } from "@/lib/extension-host/loading";

function entry(id: string, hasEditor: boolean): ClientExtensionEntry {
  const editorModule: EditorModule = {
    manifestId: id,
    commands: {},
    toolbar: [],
    overlays: {},
    dialogs: {},
    completions: null,
  };
  return {
    manifest: { id } as ExtensionManifest,
    ...(hasEditor ? { editor: async () => ({ default: editorModule }) } : {}),
  };
}

const entries = [entry("vault.a", true), entry("vault.b", true), entry("vault.c", false)];

const ids = (requests: ReturnType<typeof selectEditorModulesToLoad>) =>
  requests.map((request) => request.extensionId);

describe("selectEditorModulesToLoad", () => {
  it("loads editor modules for enabled extensions only", () => {
    expect(ids(selectEditorModulesToLoad(entries, ["vault.a"], new Set()))).toEqual([
      "vault.a",
    ]);
  });

  it("skips extensions without an editor module", () => {
    expect(ids(selectEditorModulesToLoad(entries, ["vault.c"], new Set()))).toEqual([]);
  });

  it("never requests a module twice", () => {
    expect(
      ids(selectEditorModulesToLoad(entries, ["vault.a", "vault.b"], new Set(["vault.a"]))),
    ).toEqual(["vault.b"]);
  });
});
