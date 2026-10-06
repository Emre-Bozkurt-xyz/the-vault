import { describe, expect, it } from "vitest";

import { runCommand } from "@/lib/extension-api/testing";

import editor from "./editor";

describe("vault.calc.insertBlock", () => {
  it("opens an empty block with the cursor on its first statement line", async () => {
    const result = await runCommand(editor, "vault.calc.insertBlock", "|");

    expect(result.markdown).toBe(":::calc\n\n:::\n");
    expect(result.cursor).toBe(":::calc\n".length);
  });

  it("turns a selection into the block's body", async () => {
    const result = await runCommand(
      editor,
      "vault.calc.insertBlock",
      "|rent = 1200 CAD\ndomains = 42 USD|",
    );

    expect(result.markdown).toBe(":::calc\nrent = 1200 CAD\ndomains = 42 USD\n:::\n");
  });
});
