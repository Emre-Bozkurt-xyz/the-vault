import { z } from "zod";

import { defineManifest } from "@/lib/extension-api";

export const dictionarySettingsSchema = z.object({
  /** Folder `/def` files new definitions into; null means beside the document. */
  newDefinitionFolderId: z.string().uuid().nullable().default(null),
  /**
   * How links to definitions are emphasized when *you* read. A reading
   * preference, so it never changes what other readers see.
   */
  definitionEmphasis: z.enum(["every", "first"]).default("every"),
});

export default defineManifest({
  id: "vault.dictionary",
  name: "Dictionary",
  version: 1,
  category: "editor",
  description:
    "Define terms as documents and reference them with ordinary [[wiki links]]. Hovering a term shows its definition without leaving the page.",
  defaultEnabled: false,
  permissions: ["document:read", "document:write"],
  // Hover cards decorate ordinary wiki links, so no syntax claim can say when
  // a document needs this extension's renderer.
  renderAlways: true,
  settings: {
    schema: dictionarySettingsSchema,
    defaults: { newDefinitionFolderId: null, definitionEmphasis: "every" },
    sections: [
      {
        id: "reading",
        label: "Reading",
        fields: [
          {
            type: "select",
            key: "definitionEmphasis",
            label: "Emphasize defined terms",
            description:
              "Every mention stays linked and previews on hover; this only changes which are emphasized.",
            options: [
              { label: "Every mention", value: "every" },
              { label: "First mention in a document", value: "first" },
            ],
          },
        ],
      },
      {
        id: "authoring",
        label: "Authoring",
        fields: [
          {
            type: "folder",
            key: "newDefinitionFolderId",
            label: "New definition folder",
            description: "Where /def files a new definition.",
            emptyLabel: "Same folder as the document",
          },
        ],
      },
    ],
  },
  slashCommands: [
    {
      id: "vault.dictionary.slash-define",
      label: "def",
      title: "Define a term",
      keywords: "definition dictionary glossary term explain",
      // `run`, not `insert`: this creates a document, which no markdown
      // insertion can express. The editor supplies the implementation.
      run: { command: "vault.dictionary.newDefinition" },
    },
    {
      id: "vault.dictionary.slash-reference",
      label: "term",
      title: "Reference a definition",
      keywords: "definition dictionary glossary lookup link",
      run: { command: "vault.dictionary.insertReference" },
    },
  ],
});
