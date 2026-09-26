import { describe, expect, it } from "vitest";

import type { DocumentExtensions } from "@/lib/extension-api";
import { legacyExtensionProps } from "@/lib/extension-host/legacy";

function extensions(overrides: Partial<DocumentExtensions>): DocumentExtensions {
  return {
    surface: "workspace",
    documentId: "d1",
    canEdit: true,
    renderIds: [],
    enabledIds: [],
    settings: {},
    state: {},
    data: {},
    ...overrides,
  };
}

describe("legacyExtensionProps", () => {
  it("falls back to today's defaults when nothing is resolved (embeds)", () => {
    expect(legacyExtensionProps(null)).toEqual({
      fxTable: null,
      stickerItems: [],
      definitionEmphasis: "every",
      stickersEnabled: false,
      calcEnabled: false,
      dictionaryEnabled: false,
    });
  });

  it("gates authoring on both enablement and edit access", () => {
    const enabledIds = ["vault.stickers", "vault.calc", "vault.dictionary"];

    const editor = legacyExtensionProps(extensions({ enabledIds }));
    expect([editor.stickersEnabled, editor.calcEnabled]).toEqual([true, true]);

    const reader = legacyExtensionProps(extensions({ enabledIds, canEdit: false }));
    expect([reader.stickersEnabled, reader.calcEnabled]).toEqual([false, false]);
    // The dictionary also carries a reading preference, so readers keep it.
    expect(reader.dictionaryEnabled).toBe(true);
  });

  it("reads settings and render data under their old names", () => {
    const fxTable = { base: "EUR", date: "2026-09-26", provider: "ECB", rates: {} };
    const props = legacyExtensionProps(
      extensions({
        settings: {
          "vault.dictionary": { definitionEmphasis: "first" },
        },
        data: {
          "vault.calc": { fxTable },
          "vault.stickers": { items: [] },
        },
      }),
    );

    expect(props.fxTable).toEqual(fxTable);
    expect(props.definitionEmphasis).toBe("first");
    expect(props.stickerItems).toEqual([]);
  });
});
