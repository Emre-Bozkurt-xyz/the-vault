import "server-only";

import { z } from "zod";

import {
  countWikiLinkTargets,
  wikiDocKey,
  wikiKeyForTarget,
  wikiTitleKey,
} from "@/lib/extension-api";
import { defineServer } from "@/lib/extension-api/server";

import manifest from "./manifest";

const definitionEntrySchema = z.object({
  documentId: z.string(),
  term: z.string(),
  aliases: z.array(z.string()),
  summary: z.string().nullable(),
});

const listDefinitionsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Only return definitions whose term or aliases contain this text. Omit for all of them.",
    ),
});

const listDefinitionsOutputSchema = z.object({
  definitions: z.array(definitionEntrySchema),
});

const listUndefinedTermsOutputSchema = z.object({
  terms: z.array(
    z.object({
      target: z
        .string()
        .describe("The wiki-link target as written in the document."),
      occurrences: z.number(),
    }),
  ),
});

const defineTermInputSchema = z.object({
  term: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The term to define. Becomes the definition document's title."),
  summary: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      "One-sentence definition, stored as the document's summary. This is the text a reader sees when hovering the term.",
    ),
});

const defineTermOutputSchema = z.object({
  documentId: z.string(),
  term: z.string(),
  created: z
    .boolean()
    .describe("False when an existing definition was reused."),
});

export default defineServer(manifest, {
  actions: [
    {
      id: "vault.dictionary.listDefinitions",
      title: "List definitions",
      description:
        "List the terms defined in this vault, with their synonyms and one-line definitions. Use this to answer 'what does X mean here' from the user's own glossary rather than from general knowledge, and to check whether a term is already defined before defining it.",
      scope: "workspace",
      mutates: false,
      permissions: ["document:read"],
      input: listDefinitionsInputSchema,
      output: listDefinitionsOutputSchema,
      async handler(input, context) {
        const definitions = context.definitions;

        if (!definitions) {
          throw new Error("This action requires read access.");
        }

        const { query } = input as z.infer<typeof listDefinitionsInputSchema>;
        const needle = query?.toLowerCase() ?? "";
        const rows = (await definitions.list()).filter(
          (row) =>
            !needle ||
            row.term.toLowerCase().includes(needle) ||
            row.aliases.some((alias) => alias.toLowerCase().includes(needle)),
        );

        return {
          data: { definitions: rows },
          message: `${rows.length} definition${rows.length === 1 ? "" : "s"}${query ? ` matching "${query}"` : ""}.`,
        };
      },
    },
    {
      id: "vault.dictionary.listUndefinedTerms",
      title: "List undefined terms in a document",
      description:
        "Find wiki links in a document that do not point at a definition — the glossary gaps. Use this to see which terms a document leans on without explaining them.",
      scope: "document",
      mutates: false,
      permissions: ["document:read"],
      output: listUndefinedTermsOutputSchema,
      input: z.object({}),
      async handler(_input, context) {
        const markdown = await context.document?.markdown?.read?.();
        const definitions = context.definitions;

        if (markdown === undefined || !definitions) {
          throw new Error("This action requires document read access.");
        }

        // Every key a definition can be reached by, so a link written as an
        // alias or as a raw id is not reported as a gap.
        const defined = new Set<string>();
        for (const row of await definitions.list()) {
          defined.add(wikiDocKey(row.documentId));
          defined.add(wikiTitleKey(row.term));
          for (const alias of row.aliases) {
            defined.add(wikiTitleKey(alias));
          }
        }

        const terms = [...countWikiLinkTargets(markdown).entries()]
          .filter(([target]) => !defined.has(wikiKeyForTarget(target)))
          .map(([target, occurrences]) => ({ target, occurrences }))
          .sort(
            (first, second) =>
              second.occurrences - first.occurrences ||
              first.target.localeCompare(second.target),
          );

        return {
          data: { terms },
          message: `${terms.length} referenced term${terms.length === 1 ? "" : "s"} without a definition.`,
        };
      },
    },
    {
      id: "vault.dictionary.defineTerm",
      title: "Define a term",
      description:
        "Create a definition document for a term, optionally with its one-line definition. An existing definition with the same title is reused rather than duplicated. Every wiki link to the term starts previewing it immediately.",
      scope: "workspace",
      mutates: true,
      permissions: ["document:read", "document:write"],
      input: defineTermInputSchema,
      output: defineTermOutputSchema,
      async handler(input, context) {
        const create = context.definitions?.create;

        if (!create) {
          throw new Error("This action requires write access.");
        }

        const { term, summary } = input as z.infer<
          typeof defineTermInputSchema
        >;
        const result = await create({ term, summary });

        return {
          data: result,
          message: result.created
            ? `Defined "${result.term}".`
            : // Deliberately not overwritten: the existing definition is the
              // author's text, and a passing agent call must not replace it.
              `"${result.term}" is already defined; its existing definition was kept.`,
        };
      },
    },
  ],
});
