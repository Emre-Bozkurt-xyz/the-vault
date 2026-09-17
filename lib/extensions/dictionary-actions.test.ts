import { describe, expect, it } from "vitest";

import { localBuiltInExtensions } from "@/lib/extensions/catalog";
import type {
  ExtensionAgentActionContext,
  ExtensionAgentDefinitionEntry,
  VaultExtensionAgentAction,
} from "@/lib/extensions/types";

const DEFINITIONS: ExtensionAgentDefinitionEntry[] = [
  {
    documentId: "11111111-1111-4111-8111-111111111111",
    term: "Idempotence",
    aliases: ["idempotent"],
    summary: "Repeating the call changes nothing.",
  },
  {
    documentId: "22222222-2222-4222-8222-222222222222",
    term: "Backpressure",
    aliases: [],
    summary: null,
  },
];

function action(id: string): VaultExtensionAgentAction {
  const found = localBuiltInExtensions
    .flatMap((extension) => extension.agent?.actions ?? [])
    .find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`no action ${id}`);
  }

  return found;
}

/** The sandbox the dispatcher builds, with only what these actions may use. */
function context(options: {
  markdown?: string;
  definitions?: ExtensionAgentDefinitionEntry[];
  canCreate?: boolean;
  created?: string[];
}) {
  const created = options.created ?? [];

  return {
    user: { id: "u1" },
    definitions: {
      list: async () => options.definitions ?? DEFINITIONS,
      ...(options.canCreate
        ? {
            create: async ({
              term,
              summary,
            }: {
              term: string;
              summary?: string;
            }) => {
              created.push(`${term}|${summary ?? ""}`);
              const existing = (options.definitions ?? DEFINITIONS).find(
                (row) => row.term.toLowerCase() === term.toLowerCase(),
              );

              return existing
                ? {
                    documentId: existing.documentId,
                    term: existing.term,
                    created: false,
                  }
                : { documentId: "new-id", term, created: true };
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
    const result = await listDefinitions.handler({}, context({}));

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
      (byAlias.data as { definitions: ExtensionAgentDefinitionEntry[] })
        .definitions[0].term,
    ).toBe("Idempotence");
  });

  it("refuses without the read capability", async () => {
    await expect(
      listDefinitions.handler({}, { user: { id: "u1" } }),
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

  it("creates a definition and passes the summary through", async () => {
    const created: string[] = [];
    const result = await defineTerm.handler(
      { term: "Backoff", summary: "Waiting longer after each failure." },
      context({ canCreate: true, created }),
    );

    expect(created).toEqual(["Backoff|Waiting longer after each failure."]);
    expect(result.data).toEqual({
      documentId: "new-id",
      term: "Backoff",
      created: true,
    });
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
