import { z } from "zod";

import { createVaultExtensionRegistry } from "@/lib/extensions/registry";
import type { VaultExtension } from "@/lib/extensions/types";

const stickersSettingsSchema = z.object({
  defaultVisibility: z.enum(["private", "public"]).default("private"),
  showHandles: z.enum(["always", "on-select", "never"]).default("on-select"),
  snapToGrid: z.boolean().default(false),
});

const stickerItemSchema = z.object({
  assetId: z.string(),
  left: z.number(),
  top: z.number(),
  width: z.number().default(120),
  rotation: z.number().default(0),
});

export const stickersStateSchema = z.object({
  items: z.record(z.string(), stickerItemSchema).default({}),
});

export type StickerItem = z.infer<typeof stickerItemSchema>;
export type StickersState = z.infer<typeof stickersStateSchema>;

export const calendarSettingsSchema = z.object({
  defaultVisibility: z.enum(["private", "editor-only", "public"]).default("private"),
  weekStartsOn: z.enum(["0", "1"]).default("0"),
});

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const calendarEntrySchema = z.object({
  type: z.enum(["task", "event"]),
  day: z.string().regex(dayKeyPattern),
  text: z.string().max(500).default(""),
  /** Tasks only: completion state. */
  done: z.boolean().optional(),
  /** Events only: optional `HH:MM` start time used to sort within a day. */
  time: z.string().regex(timePattern).optional(),
  note: z.string().max(2000).optional(),
  /** Manual ordering within a day cell. */
  order: z.number().default(0),
});

export const calendarStateSchema = z.object({
  entries: z.record(z.string(), calendarEntrySchema).default({}),
  /** Persisted full-bleed breakout toggle for this calendar block. */
  expanded: z.boolean().default(false),
});

export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
export type CalendarState = z.infer<typeof calendarStateSchema>;

export const localBuiltInExtensions: VaultExtension[] = [
  {
    id: "vault.calendar",
    name: "Calendar",
    version: 1,
    kind: "built-in",
    category: "document",
    description:
      "Embed a month calendar to track day-scoped tasks and event reminders inside a document.",
    defaultEnabled: false,
    permissions: [
      "document:read",
      "document:write-extension-state",
    ],
    settings: {
      schema: calendarSettingsSchema,
      defaults: {
        defaultVisibility: "private",
        weekStartsOn: "0",
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
                "Who can see a new calendar's entries. Existing calendars keep their own setting.",
              options: [
                { label: "Private", value: "private" },
                { label: "Editors only", value: "editor-only" },
                { label: "Public", value: "public" },
              ],
            },
            {
              type: "select",
              key: "weekStartsOn",
              label: "Week starts on",
              options: [
                { label: "Sunday", value: "0" },
                { label: "Monday", value: "1" },
              ],
            },
          ],
        },
      ],
    },
    documentState: {
      schemas: [
        {
          extensionId: "vault.calendar",
          version: 1,
          schema: calendarStateSchema,
        },
      ],
    },
    workspace: {
      commands: [
        {
          id: "vault.calendar.insert",
          label: "Insert calendar",
          description: "Insert a month calendar block at the cursor.",
        },
      ],
    },
  },
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
      schemas: [
        {
          extensionId: "vault.stickers",
          stateKey: "layout",
          version: 1,
          schema: stickersStateSchema,
        },
      ],
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
