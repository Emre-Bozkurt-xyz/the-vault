import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  overlays: {
    // Read-only stickers for every reader. Where a user enabled stickers and
    // can edit, the editor module's interactive layer replaces this one.
    "vault.stickers.overlay": { load: () => import("./StickerDisplay") },
  },
});
