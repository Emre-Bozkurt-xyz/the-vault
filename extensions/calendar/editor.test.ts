import { describe, expect, it } from "vitest";

import { runCommand } from "@/lib/extension-api/testing";

import editor from "./editor";

describe("vault.calendar editor", () => {
  it("inserts an anchor with a fresh id on its own line", async () => {
    const result = await runCommand(editor, "vault.calendar.insert", "Plan|");

    expect(result.markdown).toMatch(/^Plan\n\n:::calendar\{id=[a-z0-9]+\}\n$/);
    expect(result.cursor).toBe(result.markdown.length);
  });

  it("mints a different id on every insertion", async () => {
    const first = await runCommand(editor, "vault.calendar.insert", "");
    const second = await runCommand(editor, "vault.calendar.insert", "");

    expect(first.markdown).not.toBe(second.markdown);
  });

  it("offers its insert command on the toolbar", () => {
    expect(editor.toolbar.map((item) => item.command)).toEqual([
      "vault.calendar.insert",
    ]);
  });
});
