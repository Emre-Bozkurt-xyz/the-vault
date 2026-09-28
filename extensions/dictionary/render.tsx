import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  links: {
    // A definition is a document tagged `definition` (core data), so every
    // reader gets its hover card, whether or not they enabled the dictionary
    // (`docs/20_DICTIONARY_EXTENSION_PLAN.md` §2).
    preview(link, ctx) {
      if (link.resolved) {
        if (!link.isDefinition || !link.preview) return null;

        return {
          title: link.label,
          markdown: link.preview,
          // A reading preference: under "first mention" only the first link to
          // each definition is emphasized; later ones stay linked and preview.
          quiet: ctx.settings.definitionEmphasis === "first" && link.occurrence > 0,
        };
      }

      // A `[[Term]]` that resolves to nothing. Offering to define it is an
      // authoring affordance, so it needs the extension and edit access.
      if (!ctx.enabled || !ctx.canEdit) return null;

      return {
        title: link.target,
        markdown: null,
        emptyText: "Not defined yet.",
        action: {
          label: "Define",
          command: "vault.dictionary.newDefinition",
          args: { term: link.target },
        },
      };
    },
  },
});
