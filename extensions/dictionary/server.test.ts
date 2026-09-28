import { describe, expect, it } from "vitest";

import type {
  ExtensionAgentActionContext,
  ExtensionAgentDocumentSummary,
  ExtensionServerModule,
} from "@/lib/extension-api/server";

import manifest, { dictionarySettingsSchema } from "./manifest";
import server from "./server";

type ServerAction = ExtensionServerModule["actions"][number];

/** Definitions as the host's documents service lists them (tag `definition`). */
const DEFINITION_DOCUMENTS: ExtensionAgentDocumentSummary[] = [
  {
    documentId: "11111111-1111-4111-8111-111111111111",
    title: "Idempotence",
    aliases: ["idempotent"],
    summary: "Repeating the call changes nothing.",
  },
  {
    documentId: "22222222-2222-4222-8222-222222222222",
    title: "Backpressure",
    aliases: [],
    summary: null,
  },
];

/** The same, as the dictionary's actions report them. */
const DEFINITIONS = DEFINITION_DOCUMENTS.map((row) => ({
  documentId: row.documentId,
  term: row.title,
  aliases: row.aliases,
  summary: row.summary,
}));

function action(id: string): ServerAction {
  const found = server.actions.find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`no action ${id}`);
  }

  return found;
}

type CreatedDocument = {
  title: string;
  markdown: string;
  folderIds: ReadonlyArray<string | null | undefined>;
};

/** The sandbox the dispatcher builds, with only what these actions may use. */
function context(options: {
  markdown?: string;
  documents?: ExtensionAgentDocumentSummary[];
  canCreate?: boolean;
  created?: CreatedDocument[];
  listedTags?: string[];
  settings?: Record<string, unknown>;
}) {
  const created = options.created ?? [];
  const rows = options.documents ?? DEFINITION_DOCUMENTS;

  return {
    user: { id: "u1" },
    settings: options.settings ?? dictionarySettingsSchema.parse({}),
    documents: {
      listByTag: async (tagSlug: string) => {
        options.listedTags?.push(tagSlug);
        return rows;
      },
      ...(options.canCreate
        ? {
            findOwnedByTitle: async (title: string) => {
              const existing = rows.find(
                (row) => row.title.toLowerCase() === title.toLowerCase(),
              );
              return existing
                ? { documentId: existing.documentId, title: existing.title }
                : null;
            },
            create: async (input: CreatedDocument) => {
              created.push({ ...input, folderIds: input.folderIds ?? [] });
              return { documentId: "new-id", title: input.title };
            },
          }
        : {}),
    },
    document: {
      id: "d1",
      canEdit: false,
      state: {
        get: async () => null,
        set: async () => {},
        list: async () => [],
        delete: async () => {},
      },
      markdown: { read: async () => options.markdown ?? "" },
    },
  } as unknown as ExtensionAgentActionContext;
}

describe("vault.dictionary.listDefinitions", () => {
  const listDefinitions = action("vault.dictionary.listDefinitions");

  it("returns every definition with its aliases and summary", async () => {
    const listedTags: string[] = [];
    const result = await listDefinitions.handler({}, context({ listedTags }));

    expect(listedTags).toEqual(["definition"]);
    expect(result.data).toEqual({ definitions: DEFINITIONS });
    expect(result.message).toBe("2 definitions.");
  });

  it("filters on the term and on aliases", async () => {
    const byTerm = await listDefinitions.handler(
      { query: "backpress" },
      context({}),
    );
    const byAlias = await listDefinitions.handler(
      { query: "IDEMPOTENT" },
      context({}),
    );

    expect((byTerm.data as { definitions: unknown[] }).definitions).toHaveLength(1);
    expect(
      (byAlias.data as { definitions: typeof DEFINITIONS }).definitions[0].term,
    ).toBe("Idempotence");
  });

  it("refuses without the read capability", async () => {
    await expect(
      listDefinitions.handler({}, { user: { id: "u1" }, settings: {} }),
    ).rejects.toThrow(/read access/);
  });
});

describe("vault.dictionary.listUndefinedTerms", () => {
  const listUndefinedTerms = action("vault.dictionary.listUndefinedTerms");

  it("reports only links that reach no definition, most-referenced first", async () => {
    const markdown = [
      "Must be [[Idempotence|idempotent]] and handle [[Backpressure]].",
      "",
      "See [[Retry Policy]] and [[Retry Policy]] again, plus [[Dead Letter Queue]].",
    ].join("\n");
    const result = await listUndefinedTerms.handler({}, context({ markdown }));

    expect(result.data).toEqual({
      terms: [
        { target: "Retry Policy", occurrences: 2 },
        { target: "Dead Letter Queue", occurrences: 1 },
      ],
    });
  });

  it("counts a link written as an alias as defined", async () => {
    const result = await listUndefinedTerms.handler(
      {},
      context({ markdown: "Only [[idempotent]] here." }),
    );

    expect(result.data).toEqual({ terms: [] });
  });

  it("counts a link written as a raw document id as defined", async () => {
    const result = await listUndefinedTerms.handler(
      {},
      context({ markdown: `See [[${DEFINITIONS[0].documentId}]].` }),
    );

    expect(result.data).toEqual({ terms: [] });
  });

  it("ignores a transclusion, which is not a reference", async () => {
    const result = await listUndefinedTerms.handler(
      {},
      context({ markdown: "![[Some document]]" }),
    );

    expect(result.data).toEqual({ terms: [] });
  });

  it("reports nothing for a document with no links", async () => {
    const result = await listUndefinedTerms.handler(
      {},
      context({ markdown: "Just prose." }),
    );

    expect(result.message).toBe("0 referenced terms without a definition.");
  });
});

describe("vault.dictionary.defineTerm", () => {
  const defineTerm = action("vault.dictionary.defineTerm");

  it("creates a definition document with the tag and the summary", async () => {
    const created: CreatedDocument[] = [];
    const result = await defineTerm.handler(
      { term: "Backoff", summary: "Waiting longer after each failure." },
      context({ canCreate: true, created }),
    );

    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("Backoff");
    expect(created[0].markdown).toMatch(/^---\n/);
    expect(created[0].markdown).toMatch(/tags:.*definition/);
    expect(created[0].markdown).toMatch(/summary: .*Waiting longer after each failure\./);
    expect(result.data).toEqual({
      documentId: "new-id",
      term: "Backoff",
      created: true,
    });
  });

  it("files it in the configured folder first, then the author's current one", async () => {
    const created: CreatedDocument[] = [];
    const configured = "33333333-3333-4333-8333-333333333333";
    const current = "44444444-4444-4444-8444-444444444444";
    await defineTerm.handler(
      { term: "Backoff", folderId: current },
      context({
        canCreate: true,
        created,
        settings: dictionarySettingsSchema.parse({ newDefinitionFolderId: configured }),
      }),
    );

    expect(created[0].folderIds).toEqual([configured, current]);
  });

  it("keeps an existing definition rather than overwriting it", async () => {
    const result = await defineTerm.handler(
      { term: "idempotence", summary: "Something else entirely." },
      context({ canCreate: true }),
    );

    expect(result.data).toMatchObject({ created: false, term: "Idempotence" });
    expect(result.message).toMatch(/existing definition was kept/);
  });

  it("refuses without the write capability", async () => {
    await expect(
      defineTerm.handler({ term: "Backoff" }, context({})),
    ).rejects.toThrow(/write access/);
  });
});

describe("vault.dictionary settings", () => {
  const extension = manifest;

  it("parses an empty stored value to the declared defaults", () => {
    expect(dictionarySettingsSchema.parse({})).toEqual(extension?.settings?.defaults);
  });

  it("declares a field for every setting key, so none is invisible", () => {
    const fieldKeys = (extension?.settings?.sections ?? [])
      .flatMap((section) => section.fields.map((field) => field.key))
      .sort();

    expect(fieldKeys).toEqual(
      Object.keys(dictionarySettingsSchema.parse({})).sort(),
    );
  });

  it("rejects a folder id that is not a uuid and an unknown emphasis", () => {
    expect(
      dictionarySettingsSchema.safeParse({ newDefinitionFolderId: "nope" }).success,
    ).toBe(false);
    expect(
      dictionarySettingsSchema.safeParse({ definitionEmphasis: "loud" }).success,
    ).toBe(false);
  });
});
