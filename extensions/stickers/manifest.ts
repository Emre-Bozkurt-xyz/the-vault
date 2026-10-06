import { z } from "zod";

import { defineManifest } from "@/lib/extension-api";

export const stickersSettingsSchema = z.object({
  defaultVisibility: z.enum(["private", "public"]).default("private"),
  showHandles: z.enum(["always", "on-select", "never"]).default("on-select"),
  snapToGrid: z.boolean().default(false),
});

export default defineManifest({
  id: "vault.stickers",
  name: "Stickers",
  version: 1,
  category: "visual",
  description:
    "Place asset-backed stickers and visual annotations around a document page.",
  defaultEnabled: false,
  permissions: [
    "document:read",
    "document:write-extension-state",
    "asset:read",
  ],
  settings: {
    schema: stickersSettingsSchema,
    defaults: {
      defaultVisibility: "private",
      showHandles: "on-select",
      snapToGrid: false,
    },
    sections: [
      {
        id: "behavior",
        label: "Behavior",
        fields: [
          {
            type: "select",
            key: "defaultVisibility",
            label: "Default visibility",
            description:
              "New sticker state starts private unless explicitly made public later.",
            options: [
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ],
          },
          {
            type: "select",
            key: "showHandles",
            label: "Selection handles",
            options: [
              { label: "On select", value: "on-select" },
              { label: "Always", value: "always" },
              { label: "Never", value: "never" },
            ],
          },
          {
            type: "toggle",
            key: "snapToGrid",
            label: "Snap to grid",
            description: "Align moved stickers to a small page grid.",
          },
        ],
      },
    ],
  },
  overlays: [{ id: "vault.stickers.overlay" }],
  commands: [
    {
      id: "vault.stickers.add",
      label: "Add sticker",
      description: "Add a sticker to the current document.",
    },
    {
      id: "vault.stickers.toggle-layer",
      label: "Toggle sticker layer",
      description: "Show or hide sticker overlays in the current document.",
    },
  ],
});
