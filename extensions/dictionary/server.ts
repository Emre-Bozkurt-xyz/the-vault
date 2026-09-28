import "server-only";

import { z } from "zod";

import {
  countWikiLinkTargets,
  wikiDocKey,
  wikiKeyForTarget,
  wikiTitleKey,
} from "@/lib/extension-api";
import {
  defineServer,
  definitionTagSlug,
  updateDocumentMetadataFrontmatter,
  type ExtensionAgentDocumentsApi,
} from "@/lib/extension-api/server";

import manifest, { dictionarySettingsSchema } from "./manifest";

/**
 * A definition is a document tagged `definition` whose title is the term, whose
 * `aliases:` are the synonyms and whose `summary:` is the hover text
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md`). The host stores and resolves them as
 * ordinary documents; this is where they are listed and made.
 */
async function listDefinitions(documents: ExtensionAgentDocumentsApi) {
  return (await documents.listByTag(definitionTagSlug)).map((row) => ({
    documentId: row.documentId,
    term: row.title,
    aliases: row.aliases,
    summary: row.summary,
  }));
}

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
  folderId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      "Folder to file a new definition in when the user has not configured one. Omit to use their vault root.",
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
        const documents = context.documents;

        if (!documents) {
          throw new Error("This action requires read access.");
        }

        const { query } = input as z.infer<typeof listDefinitionsInputSchema>;
        const needle = query?.toLowerCase() ?? "";
        const rows = (await listDefinitions(documents)).filter(
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
        const documents = context.documents;

        if (markdown === undefined || !documents) {
          throw new Error("This action requires document read access.");
        }

        // Every key a definition can be reached by, so a link written as an
        // alias or as a raw id is not reported as a gap.
        const defined = new Set<string>();
        for (const row of await listDefinitions(documents)) {
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
        const documents = context.documents;

        if (!documents?.create || !documents.findOwnedByTitle) {
          throw new Error("This action requires write access.");
        }

        const { term, summary, folderId } = input as z.infer<
          typeof defineTermInputSchema
        >;

        // Reuse a document the author already has with this title rather than
        // minting a second: defining a term that exists has to mean "link me
        // to it", or the vault quietly accumulates duplicates whose wiki links
        // then resolve as ambiguous. Its summary is never overwritten: it is
        // the author's text.
        const existing = await documents.findOwnedByTitle(term);
        let result: { documentId: string; term: string; created: boolean };

        if (existing) {
          result = { documentId: existing.documentId, term: existing.title, created: false };
        } else {
          const settings = dictionarySettingsSchema.safeParse(context.settings);
          // Built through the shared serializer, so a summary with a colon or
          // a quote is escaped exactly as the Properties panel would. The tag
          // is written even when a folder would supply it, so the document
          // stays a definition if it is later moved somewhere that would not.
          const markdown = updateDocumentMetadataFrontmatter("", {
            tags: [definitionTagSlug],
            aliases: [],
            summary: summary || null,
            status: null,
            project: null,
          });
          const created = await documents.create({
            title: term,
            markdown,
            // The configured folder first, then the one the author is writing
            // in; each is permission-checked, and neither being usable files
            // it at the vault root.
            folderIds: [
              settings.success ? settings.data.newDefinitionFolderId : null,
              folderId,
            ],
          });
          result = { documentId: created.documentId, term: created.title, created: true };
        }

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
