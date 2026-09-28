import { describe, expect, it } from "vitest";

import type { WikiLinkInfo } from "@/lib/extension-api";
import { createTestContext, runCommand } from "@/lib/extension-api/testing";

import editor from "./editor";
import manifest from "./manifest";
import render from "./render";

function link(overrides: Partial<WikiLinkInfo>): WikiLinkInfo {
  return {
    target: "Idempotence",
    label: "Idempotence",
    href: "/docs/def",
    resolved: true,
    isDefinition: true,
    preview: "Repeating it changes nothing.",
    occurrence: 0,
    ...overrides,
  };
}

const preview = render.links!.preview;

describe("vault.dictionary link preview", () => {
  it("previews a link to a definition, for any reader", () => {
    const reader = createTestContext(manifest, { enabled: false, canEdit: false });

    expect(preview(link({}), reader)).toEqual({
      title: "Idempotence",
      markdown: "Repeating it changes nothing.",
      quiet: false,
    });
  });

  it("leaves other links, and definitions with nothing to show, alone", () => {
    const ctx = createTestContext(manifest);

    expect(preview(link({ isDefinition: false, preview: null }), ctx)).toBeNull();
    expect(preview(link({ preview: null }), ctx)).toBeNull();
  });

  it("quiets repeat mentions only under the reader's first-mention setting", () => {
    const every = createTestContext(manifest);
    const first = createTestContext(manifest, {
      settings: { ...every.settings, definitionEmphasis: "first" },
    });

    expect(preview(link({ occurrence: 1 }), every)?.quiet).toBe(false);
    expect(preview(link({ occurrence: 0 }), first)?.quiet).toBe(false);
    expect(preview(link({ occurrence: 1 }), first)?.quiet).toBe(true);
  });

  it("offers to define an unresolved term only to an author who enabled it", () => {
    const unresolved = link({
      target: "Backoff",
      label: "Backoff",
      href: null,
      resolved: false,
      isDefinition: false,
      preview: null,
    });

    expect(preview(unresolved, createTestContext(manifest))).toEqual({
      title: "Backoff",
      markdown: null,
      emptyText: "Not defined yet.",
      action: {
        label: "Define",
        command: "vault.dictionary.newDefinition",
        args: { term: "Backoff" },
      },
    });
    expect(preview(unresolved, createTestContext(manifest, { enabled: false }))).toBeNull();
    expect(preview(unresolved, createTestContext(manifest, { canEdit: false }))).toBeNull();
  });
});

describe("vault.dictionary editor", () => {
  const created = { documentId: "new-id", title: "Backoff", created: true, hasSummary: false };

  it("defines the selected term, links it with the resolved title, and opens a stub", async () => {
    const result = await runCommand(editor, "vault.dictionary.newDefinition", "Use |backoff| here", {
      dialogResult: () => created,
    });

    expect(result.dialogs).toEqual([
      { id: "newDefinition", props: { term: "backoff", linksHere: true } },
    ]);
    expect(result.markdown).toBe("Use [[Backoff]] here");
    expect(result.openedDocuments).toEqual([{ documentId: "new-id", title: "Backoff" }]);
  });

  it("does not open a definition created with its definition line", async () => {
    const result = await runCommand(editor, "vault.dictionary.newDefinition", "|", {
      dialogResult: () => ({ ...created, hasSummary: true }),
    });

    expect(result.openedDocuments).toEqual([]);
  });

  it("defines an existing link without inserting a second one", async () => {
    const result = await runCommand(editor, "vault.dictionary.newDefinition", "See [[Backoff]]|", {
      args: { term: "Backoff" },
      dialogResult: () => created,
    });

    expect(result.dialogs[0].props).toEqual({ term: "Backoff", linksHere: false });
    expect(result.markdown).toBe("See [[Backoff]]");
  });

  it("changes nothing when the dialog is dismissed", async () => {
    const result = await runCommand(editor, "vault.dictionary.newDefinition", "Text|");

    expect(result.markdown).toBe("Text");
    expect(result.openedDocuments).toEqual([]);
  });

  it("references a definition through a link completion narrowed to definitions", async () => {
    const result = await runCommand(editor, "vault.dictionary.insertReference", "Text|");
    const filter = result.linkCompletions[0]?.filter;

    expect(filter?.(link({}))).toBe(true);
    expect(filter?.(link({ isDefinition: false }))).toBe(false);
  });
});
