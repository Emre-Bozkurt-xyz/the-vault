import { defineEditor, escapeWikiLinkLabel } from "@/lib/extension-api";

import manifest from "./manifest";
import NewDefinitionDialogHost, { type NewDefinitionResult } from "./NewDefinitionDialog";

export default defineEditor(manifest, {
  commands: {
    // `/def`, or "Define" on an unresolved link's hover card (which passes the
    // link's term as `args.term`).
    "vault.dictionary.newDefinition": async (editor, context) => {
      const fromLink = (context.args as { term?: unknown } | undefined)?.term;
      const definingLink = typeof fromLink === "string";
      // A selected word is almost always the term being defined.
      const term = definingLink ? fromLink : editor.selection().text.trim();

      const result = (await editor.openDialog("newDefinition", {
        term,
        linksHere: !definingLink,
      })) as NewDefinitionResult | null;

      if (!result) return;

      if (!definingLink) {
        // The resolved title, not the typed term: an existing definition is
        // reused, and the link has to name it.
        editor.insertInline(`[[${escapeWikiLinkLabel(result.title)}]]`);
      }

      // Only a definition that still needs writing earns a tab — one created
      // with its definition line is already complete. Never a navigation
      // either way: the author is mid-sentence.
      if (result.created && !result.hasSummary) {
        editor.openDocument(result.documentId, result.title);
      }
    },
    // `/term`: a wiki-link completion narrowed to definitions.
    "vault.dictionary.insertReference": (editor) =>
      editor.openLinkCompletion({ filter: (link) => link.isDefinition }),
  },
  dialogs: { newDefinition: NewDefinitionDialogHost },
});
