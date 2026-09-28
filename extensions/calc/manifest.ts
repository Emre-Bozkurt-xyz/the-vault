import { defineManifest } from "@/lib/extension-api";

export default defineManifest({
  id: "vault.calc",
  name: "Calc",
  version: 1,
  category: "editor",
  description:
    "Inline computed values in prose: :calc[rent = 1200 CAD] and :calc[rent * 3 in USD], with currency conversion from daily ECB rates.",
  defaultEnabled: false,
  permissions: ["document:read"],
  syntax: { containers: ["calc"], inline: ["calc"] },
  slashCommands: [
    {
      id: "vault.calc.slash",
      label: "calc",
      title: "Calc value",
      keywords: "calculate money currency total sum expression",
      // Inline, not block: an inline value belongs inside the sentence
      // being written, so it must not break the paragraph the way every
      // other extension insertion does.
      insert: { markdown: ":calc[]", cursorOffset: 6, placement: "inline" },
    },
    {
      id: "vault.calc.slash-block",
      label: "calcblock",
      title: "Calc declarations",
      keywords: "calculate money variables inputs block",
      directive: "calc",
      // Cursor lands on the blank middle line, ready for the first binding.
      insert: { markdown: ":::calc\n\n:::", cursorOffset: 8 },
    },
  ],
  commands: [
    {
      id: "vault.calc.insertBlock",
      label: "Insert calc block",
      description: "Insert a :::calc declarations block; a selection becomes its body.",
    },
  ],
});
