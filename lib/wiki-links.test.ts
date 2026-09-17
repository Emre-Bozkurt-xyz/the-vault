import { describe, expect, it } from "vitest";

import {
  buildDefinitionsByHref,
  buildWikiLinkResolutionMap,
  hrefWithoutFragment,
  wikiDocKey,
  wikiPublicKey,
  wikiTitleKey,
} from "@/lib/wiki-links";

type Row = {
  id: string;
  title: string;
  markdown?: string;
  visibility: string;
  publicSlug: string | null;
  ownerUsername?: string | null;
};

function row(overrides: Partial<Row> & { id: string; title: string }): Row {
  return {
    markdown: "",
    visibility: "private",
    publicSlug: null,
    ownerUsername: "emre",
    ...overrides,
  };
}

const workspaceHref = (document: Row) => `/docs/${document.id}`;

describe("buildWikiLinkResolutionMap", () => {
  it("registers doc, public and title keys for one document", () => {
    const resolutions = buildWikiLinkResolutionMap(
      [row({ id: "a", title: "Design Notes", publicSlug: "design-notes" })],
      workspaceHref,
    );

    expect(resolutions[wikiDocKey("a")]?.status).toBe("resolved");
    expect(resolutions[wikiDocKey("a")]?.href).toBe("/docs/a");
    expect(resolutions[wikiPublicKey("design-notes")]?.source).toBe("public");
    expect(resolutions[wikiTitleKey("design notes")]?.documentId).toBe("a");
  });

  it("marks a title claimed by two documents ambiguous", () => {
    const resolutions = buildWikiLinkResolutionMap(
      [row({ id: "a", title: "Notes" }), row({ id: "b", title: "notes" })],
      workspaceHref,
    );

    expect(resolutions[wikiTitleKey("Notes")]?.status).toBe("ambiguous");
  });

  it("does not let a repeated row make a document ambiguous with itself", () => {
    const duplicate = row({ id: "a", title: "Notes" });
    const resolutions = buildWikiLinkResolutionMap(
      [duplicate, { ...duplicate }],
      workspaceHref,
    );

    expect(resolutions[wikiTitleKey("Notes")]?.status).toBe("resolved");
    expect(resolutions[wikiTitleKey("Notes")]?.documentId).toBe("a");
  });

  it("returns a private resolution when no href is available", () => {
    const resolutions = buildWikiLinkResolutionMap(
      [row({ id: "a", title: "Hidden" })],
      () => null,
    );

    expect(resolutions[wikiDocKey("a")]).toEqual({
      status: "private",
      source: "document",
      label: "Hidden",
      ownerUsername: "emre",
    });
  });

  describe("aliases", () => {
    it("resolves a document by an alias from its frontmatter", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [
          row({
            id: "a",
            title: "Idempotence",
            markdown: "---\naliases:\n  - idempotent\n  - idempotency\n---\n\nbody\n",
          }),
        ],
        workspaceHref,
      );

      expect(resolutions[wikiTitleKey("idempotent")]?.documentId).toBe("a");
      expect(resolutions[wikiTitleKey("idempotency")]?.documentId).toBe("a");
    });

    it("lets a real title win over another document's alias", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [
          row({ id: "real", title: "Retry" }),
          row({ id: "aliased", title: "Idempotence", markdown: "---\naliases: Retry\n---\n" }),
        ],
        workspaceHref,
      );

      expect(resolutions[wikiTitleKey("Retry")]?.documentId).toBe("real");
    });

    it("marks an alias claimed by two documents ambiguous", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [
          row({ id: "a", title: "One", markdown: "---\naliases: shared\n---\n" }),
          row({ id: "b", title: "Two", markdown: "---\naliases: shared\n---\n" }),
        ],
        workspaceHref,
      );

      expect(resolutions[wikiTitleKey("shared")]?.status).toBe("ambiguous");
    });

    it("ignores aliases when title keys are off", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [row({ id: "a", title: "Idempotence", markdown: "---\naliases: idempotent\n---\n" })],
        workspaceHref,
        { includeTitleKeys: false },
      );

      expect(resolutions[wikiTitleKey("idempotent")]).toBeUndefined();
      expect(resolutions[wikiTitleKey("Idempotence")]).toBeUndefined();
      expect(resolutions[wikiDocKey("a")]?.status).toBe("resolved");
    });
  });

  describe("definitions", () => {
    const definition = row({
      id: "def",
      title: "Idempotence",
      markdown: "---\nsummary: Repeating it changes nothing.\n---\n\nLonger body.\n",
    });

    it("flags a definition and carries its preview on every key it claims", () => {
      const resolutions = buildWikiLinkResolutionMap([definition], workspaceHref, {
        definitionDocumentIds: new Set(["def"]),
      });

      for (const key of [wikiDocKey("def"), wikiTitleKey("Idempotence")]) {
        expect(resolutions[key]?.isDefinition).toBe(true);
        expect(resolutions[key]?.preview).toBe("Repeating it changes nothing.");
      }
    });

    it("leaves both fields unset for a document that is not a definition", () => {
      const resolutions = buildWikiLinkResolutionMap([definition], workspaceHref, {
        definitionDocumentIds: new Set(),
      });

      expect(resolutions[wikiDocKey("def")]?.isDefinition).toBeUndefined();
      expect(resolutions[wikiDocKey("def")]?.preview).toBeUndefined();
    });

    it("flags a definition reached by an alias", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [
          row({
            id: "def",
            title: "Idempotence",
            markdown: "---\naliases: idempotent\nsummary: Repeating it changes nothing.\n---\n",
          }),
        ],
        workspaceHref,
        { definitionDocumentIds: new Set(["def"]) },
      );

      expect(resolutions[wikiTitleKey("idempotent")]?.isDefinition).toBe(true);
      expect(resolutions[wikiTitleKey("idempotent")]?.preview).toBe(
        "Repeating it changes nothing.",
      );
    });

    it("falls back to the first body block when there is no summary", () => {
      const resolutions = buildWikiLinkResolutionMap(
        [row({ id: "def", title: "Term", markdown: "# Term\n\nThe body sentence.\n" })],
        workspaceHref,
        { definitionDocumentIds: new Set(["def"]) },
      );

      expect(resolutions[wikiDocKey("def")]?.preview).toBe("The body sentence.");
    });

    it("never sets a preview on an unreachable definition", () => {
      const resolutions = buildWikiLinkResolutionMap([definition], () => null, {
        definitionDocumentIds: new Set(["def"]),
      });

      expect(resolutions[wikiDocKey("def")]?.status).toBe("private");
      expect(resolutions[wikiDocKey("def")]?.preview).toBeUndefined();
      expect(resolutions[wikiDocKey("def")]?.isDefinition).toBeUndefined();
    });
  });

  describe("embed markdown", () => {
    it("is included by default and omitted when asked", () => {
      const rows = [row({ id: "a", title: "A", markdown: "body" })];

      expect(
        buildWikiLinkResolutionMap(rows, workspaceHref)[wikiDocKey("a")]
          ?.embedMarkdown,
      ).toBe("body");
      expect(
        buildWikiLinkResolutionMap(rows, workspaceHref, { includeEmbeds: false })[
          wikiDocKey("a")
        ]?.embedMarkdown,
      ).toBeUndefined();
      expect(
        buildWikiLinkResolutionMap(rows, workspaceHref, false)[wikiDocKey("a")]
          ?.embedMarkdown,
      ).toBeUndefined();
    });
  });
});

describe("hrefWithoutFragment", () => {
  it("drops a fragment and leaves a plain href alone", () => {
    expect(hrefWithoutFragment("/docs/a#section")).toBe("/docs/a");
    expect(hrefWithoutFragment("/docs/a")).toBe("/docs/a");
    expect(hrefWithoutFragment("/docs/a#%5Eblock")).toBe("/docs/a");
  });
});

describe("buildDefinitionsByHref", () => {
  const resolutions = buildWikiLinkResolutionMap(
    [
      row({
        id: "def",
        title: "Idempotence",
        markdown: [
          "---",
          "aliases: idempotent",
          "summary: Repeating it changes nothing.",
          "---",
          "",
        ].join("\n"),
      }),
      row({ id: "plain", title: "Plain" }),
    ],
    workspaceHref,
    { definitionDocumentIds: new Set(["def"]) },
  );

  it("indexes a definition by its href, once", () => {
    const definitions = buildDefinitionsByHref(resolutions);

    expect(definitions.size).toBe(1);
    expect(definitions.get("/docs/def")).toEqual({
      label: "Idempotence",
      preview: "Repeating it changes nothing.",
    });
  });

  it("excludes non-definitions", () => {
    expect(buildDefinitionsByHref(resolutions).has("/docs/plain")).toBe(false);
  });

  it("excludes a definition with nothing to show", () => {
    const empty = buildWikiLinkResolutionMap(
      [row({ id: "def", title: "Term", markdown: "" })],
      workspaceHref,
      { definitionDocumentIds: new Set(["def"]) },
    );

    expect(buildDefinitionsByHref(empty).size).toBe(0);
  });

  it("returns an empty index when there is no resolution map", () => {
    expect(buildDefinitionsByHref(undefined).size).toBe(0);
  });

  it("caches per resolution map and re-derives for a different one", () => {
    const first = buildDefinitionsByHref(resolutions);

    expect(buildDefinitionsByHref(resolutions)).toBe(first);
    expect(buildDefinitionsByHref({ ...resolutions })).not.toBe(first);
  });
});
