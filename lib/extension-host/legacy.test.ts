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
      calcEnabled: false,
    });
  });

  it("gates calc authoring on both enablement and edit access", () => {
    const enabledIds = ["vault.calc"];

    expect(legacyExtensionProps(extensions({ enabledIds })).calcEnabled).toBe(true);
    expect(
      legacyExtensionProps(extensions({ enabledIds, canEdit: false })).calcEnabled,
    ).toBe(false);
  });

  it("reads calc's render data under its old name", () => {
    const fxTable = { base: "EUR", date: "2026-09-26", provider: "ECB", rates: {} };
    const props = legacyExtensionProps(
      extensions({ data: { "vault.calc": { fxTable } } }),
    );

    expect(props.fxTable).toEqual(fxTable);
  });
});
