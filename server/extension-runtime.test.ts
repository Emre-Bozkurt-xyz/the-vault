import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which extension state a rendered document receives, per surface
 * (`docs/23_EXTENSION_SDK_PLAN.md` §9, acceptance §15): an anonymous or
 * token-scoped surface must never be handed a private row. The two readers are
 * mocked to return what their permission-checked queries would, so what is
 * tested is the routing: which reader each surface may reach.
 */

const readers = vi.hoisted(() => ({
  publicRows: vi.fn(),
  userRows: vi.fn(),
}));

vi.mock("@/db", () => ({
  // Only `filterPublicAssets` touches the database directly.
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
}));
vi.mock("@/server/document-extensions", () => ({
  listPublicDocumentExtensionStates: readers.publicRows,
  listDocumentExtensionStatesForUser: readers.userRows,
}));
vi.mock("@/server/fx-rates", () => ({ getFxRateTable: async () => null }));
vi.mock("@/server/user-settings", () => ({ listUserExtensionSettings: async () => [] }));

const { resolveDocumentExtensions } = await import("@/server/extension-runtime");

function row(stateKey: string, visibility: "public" | "private" | "editor-only") {
  return {
    extensionId: "vault.calendar",
    stateKey,
    state: { entries: [] },
    visibility,
    version: 1,
  };
}

const PUBLIC_ROW = row("calendar:open", "public");
const PRIVATE_ROW = row("calendar:mine", "private");

function resolve(surface: "workspace" | "public" | "share" | "guide" | "embed") {
  return resolveDocumentExtensions({
    surface,
    document: { id: "11111111-1111-4111-8111-111111111111", markdown: ":::calendar{id=open}" },
    canEdit: false,
    userId: surface === "workspace" ? "u1" : null,
    viewer: { enabledIds: [], settings: {} },
  });
}

beforeEach(() => {
  readers.publicRows.mockReset().mockResolvedValue([PUBLIC_ROW]);
  readers.userRows.mockReset().mockResolvedValue([PUBLIC_ROW, PRIVATE_ROW]);
});

describe("extension state per surface", () => {
  it("reads a public page's state only through the public reader", async () => {
    const extensions = await resolve("public");

    expect(readers.publicRows).toHaveBeenCalledOnce();
    expect(readers.userRows).not.toHaveBeenCalled();
    expect(Object.keys(extensions.state["vault.calendar"] ?? {})).toEqual(["calendar:open"]);
  });

  it.each(["share", "guide", "embed"] as const)(
    "hands the %s surface no state rows at all",
    async (surface) => {
      const extensions = await resolve(surface);

      expect(readers.publicRows).not.toHaveBeenCalled();
      expect(readers.userRows).not.toHaveBeenCalled();
      expect(extensions.state).toEqual({});
    },
  );

  it("reads the workspace through the viewer's permission-checked reader", async () => {
    const extensions = await resolve("workspace");

    expect(readers.userRows).toHaveBeenCalledWith({
      userId: "u1",
      documentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(Object.keys(extensions.state["vault.calendar"] ?? {}).sort()).toEqual([
      "calendar:mine",
      "calendar:open",
    ]);
  });

  it("still renders content-claimed extensions without any state", async () => {
    const extensions = await resolve("share");

    expect(extensions.renderIds).toContain("vault.calendar");
  });
});
