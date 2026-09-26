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
      definitionEmphasis: "every",
      calcEnabled: false,
      dictionaryEnabled: false,
    });
  });

  it("gates authoring on both enablement and edit access", () => {
    const enabledIds = ["vault.calc", "vault.dictionary"];

    const editor = legacyExtensionProps(extensions({ enabledIds }));
    expect(editor.calcEnabled).toBe(true);

    const reader = legacyExtensionProps(extensions({ enabledIds, canEdit: false }));
    expect(reader.calcEnabled).toBe(false);
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
        },
      }),
    );

    expect(props.fxTable).toEqual(fxTable);
    expect(props.definitionEmphasis).toBe("first");
  });
});
