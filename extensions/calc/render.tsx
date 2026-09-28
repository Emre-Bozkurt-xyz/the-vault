import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  blocks: {
    // `:::calc` … `:::` binds names for the whole document. Its source stays
    // editable in Live mode, where `live` draws the rows in place.
    calc: {
      form: "container",
      live: "source",
      load: () => import("./CalcBlock"),
    },
  },
  inline: {
    // `:calc[rent * 3 in USD]{dp=0}`, read as prose, not as a widget.
    calc: { load: () => import("./CalcInline") },
  },
  // Every value evaluated once, in document order, before any renders.
  analyze: { load: () => import("./analyze") },
  live: { load: () => import("./live") },
});
