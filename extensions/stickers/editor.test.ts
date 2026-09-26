import { describe, expect, it } from "vitest";

import { runCommand } from "@/lib/extension-api/testing";

import editor from "./editor";

const asset = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "image" as const,
  displayName: "Cat.png",
  mimeType: "image/png",
};

describe("vault.stickers editor", () => {
  it("asks for an image and hands the pick to the sticker layer", async () => {
    const requests: unknown[] = [];
    const result = await runCommand(editor, "vault.stickers.add", "Text|", {
      pickAsset: (request) => {
        requests.push(request);
        return asset;
      },
    });

    expect(requests).toEqual([{ kinds: ["image"], title: "Pick a sticker" }]);
    expect(result.events).toEqual([{ name: "place", payload: asset }]);
    // Stickers live in extension state, never in the Markdown.
    expect(result.markdown).toBe("Text");
  });

  it("does nothing when the picker is dismissed", async () => {
    const result = await runCommand(editor, "vault.stickers.add", "Text|");
    expect(result.events).toEqual([]);
  });

  it("toggles the layer", async () => {
    const result = await runCommand(editor, "vault.stickers.toggle-layer", "");
    expect(result.events).toEqual([{ name: "toggle-layer", payload: undefined }]);
  });

  it("offers the interactive overlay for its manifest overlay", () => {
    expect(Object.keys(editor.overlays)).toEqual(["vault.stickers.overlay"]);
  });
});
