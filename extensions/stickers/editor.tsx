import { Sticker } from "lucide-react";

import { defineEditor } from "@/lib/extension-api";

import manifest from "./manifest";
import StickerLayer from "./StickerLayer";

export default defineEditor(manifest, {
  commands: {
    // Pick an image, then hand it to the sticker layer, which places it on
    // the document once its current layout has loaded.
    "vault.stickers.add": async (editor, context) => {
      const asset = await editor.pickAsset({ kinds: ["image"], title: "Pick a sticker" });
      if (asset) context.emit("place", asset);
    },
    "vault.stickers.toggle-layer": (_editor, context) => context.emit("toggle-layer"),
  },
  toolbar: [{ command: "vault.stickers.add", label: "Add sticker", icon: Sticker }],
  overlays: { "vault.stickers.overlay": StickerLayer },
});
