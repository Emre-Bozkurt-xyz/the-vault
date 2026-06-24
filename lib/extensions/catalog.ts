import { z } from "zod";

import { createVaultExtensionRegistry } from "@/lib/extensions/registry";
import type { VaultExtension } from "@/lib/extensions/types";

const stickersSettingsSchema = z.object({
  defaultVisibility: z.enum(["private", "public"]).default("private"),
  showHandles: z.enum(["always", "on-select", "never"]).default("on-select"),
  snapToGrid: z.boolean().default(false),
});

export const localBuiltInExtensions: VaultExtension[] = [
  {
    id: "vault.stickers",
    name: "Stickers",
    version: 1,
    kind: "built-in",
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
    documentState: {
      schemas: [],
      overlays: [{ id: "vault.stickers.overlay" }],
    },
    workspace: {
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
    },
  },
];

export const localExtensionRegistry = createVaultExtensionRegistry(
  localBuiltInExtensions,
);

export function getLocalExtensionIds() {
  return localBuiltInExtensions.map((extension) => extension.id);
}
