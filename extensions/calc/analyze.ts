import type { Analyzer } from "@/lib/extension-api";

import { fxTableOf } from "./lib/context";
import { buildCalcDocument } from "./lib/document";
import { parseCalcSettings } from "./lib/settings";

/**
 * Calc's pre-pass (`docs/23_EXTENSION_SDK_PLAN.md` §6): every value in the
 * document evaluated once, top to bottom, so names bind across the whole page.
 * Components look their result up by occurrence key.
 *
 * `calc_currency` is read from the document's frontmatter here, so every surface
 * that renders a document honours it. `calc_rate_date` cannot work this way: it
 * decides which table to *fetch*, which `loadRenderData` does before render.
 */
const analyzeCalc: Analyzer = (document, ctx) =>
  buildCalcDocument(document, {
    fxTable: fxTableOf(ctx),
    displayCurrency: parseCalcSettings(document.markdown).displayCurrency,
  });

export default analyzeCalc;
