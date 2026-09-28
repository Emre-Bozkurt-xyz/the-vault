import { Calculator } from "lucide-react";

import { defineEditor } from "@/lib/extension-api";

import { createCalcCompletionSource } from "./completions";
import { fxTableOf } from "./lib/context";
import manifest from "./manifest";

const OPENING = ":::calc\n";

export default defineEditor(manifest, {
  commands: {
    // A selection becomes the body, so lines already written as
    // `rent = 1200 CAD` turn into a block in place; with nothing selected the
    // cursor lands on a blank first statement line, ready for the first binding.
    "vault.calc.insertBlock": (editor) => {
      const selected = editor.selection().text.trim();

      editor.insertBlock(
        `${OPENING}${selected}\n:::`,
        selected ? undefined : { cursorOffset: OPENING.length },
      );
    },
  },
  toolbar: [
    { command: "vault.calc.insertBlock", label: "Insert calc block", icon: Calculator },
  ],
  // Operand completion inside `:calc[…]` and `:::calc` bodies: the names this
  // document binds, currencies, and functions.
  completions: (ctx) => [createCalcCompletionSource({ fxTable: fxTableOf(ctx) })],
});
