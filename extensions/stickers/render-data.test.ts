import { describe, expect, it } from "vitest";

import type { ExtensionSurface } from "@/lib/extension-api";
import type { RenderDataContext } from "@/lib/extension-api/server";

import server from "./server";

function context(
  surface: ExtensionSurface,
  layout: unknown,
  publicAssetIds: string[],
): RenderDataContext {
  return {
    document: { id: "d1", markdown: "" },
    surface,
    canEdit: false,
    settings: {},
    state:
      layout === undefined
        ? {}
        : { layout: { state: layout as never, visibility: "public", version: 1 } },
    fx: { getTable: async () => null },
    assets: {
      filterPublic: async (ids) => ids.filter((id) => publicAssetIds.includes(id)),
    },
  };
}

const layout = {
  items: {
    s1: { assetId: "a-public", left: 1, top: 2, width: 120, rotation: 0 },
    s2: { assetId: "a-private", left: 3, top: 4, width: 90, rotation: 10 },
  },
};

describe("vault.stickers loadRenderData", () => {
  it("shows only stickers whose image is public on public pages", async () => {
    expect(await server.loadRenderData!(context("public", layout, ["a-public"]))).toEqual({
      items: [{ id: "s1", assetId: "a-public", left: 1, top: 2, width: 120, rotation: 0 }],
    });
  });

  it("returns no items when there is no public layout", async () => {
    expect(await server.loadRenderData!(context("public", undefined, []))).toEqual({
      items: [],
    });
    expect(
      await server.loadRenderData!(context("public", { items: "broken" }, [])),
    ).toEqual({ items: [] });
  });

  // Workspace readers read the layout from state; share links, guides and
  // embeds show no stickers, as before.
  it("loads nothing outside public pages", async () => {
    expect(await server.loadRenderData!(context("workspace", layout, ["a-public"]))).toBeNull();
    expect(await server.loadRenderData!(context("share", layout, ["a-public"]))).toBeNull();
    expect(await server.loadRenderData!(context("embed", layout, ["a-public"]))).toBeNull();
  });
});
