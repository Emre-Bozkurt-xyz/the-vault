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

/**
 * The instance handle for a calendar block. A document can hold several
 * calendars; each persists under the state key `calendar:<calendarId>`, matching
 * the id embedded in the in-document live block.
 */
const calendarIdInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i)
  .describe("Calendar instance id (the <id> in its `calendar:<id>` state key).");

const listEntriesInputSchema = z.object({
  calendarId: calendarIdInputSchema
    .optional()
    .describe(
      "A specific calendar to read. Omit to list all calendars in the document with their entry counts.",
    ),
});

const addEntryInputSchema = z.object({
  calendarId: calendarIdInputSchema,
  type: z
    .enum(["task", "event"])
    .default("task")
    .describe("'task' (completable) or 'event' (time-anchored reminder)."),
  day: z
    .string()
    .regex(dayKeyPattern)
    .describe("The day this entry belongs to, as YYYY-MM-DD."),
  text: z.string().max(500).default("").describe("The entry's label."),
  time: z
    .string()
    .regex(timePattern)
    .optional()
    .describe("Events only: optional HH:MM start time."),
  note: z.string().max(2000).optional().describe("Optional longer note."),
});

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
    agent: {
      actions: [
        {
          id: "vault.calendar.listEntries",
          title: "List calendar entries",
          description:
            "Read a document's calendar data. With a calendarId, returns that calendar's tasks and events; without one, lists every calendar in the document and how many entries each has.",
          scope: "document",
          mutates: false,
          permissions: ["document:read"],
          input: listEntriesInputSchema,
          async handler(input, context) {
            const document = context.document;
            if (!document) {
              throw new Error("This action requires a document.");
            }

            const { calendarId } = input as z.infer<
              typeof listEntriesInputSchema
            >;

            if (calendarId) {
              const raw = await document.state.get(`calendar:${calendarId}`);
              if (!raw) {
                return {
                  message: `No calendar "${calendarId}" exists in this document.`,
                  data: { calendarId, entries: [] },
                };
              }
              const state = calendarStateSchema.parse(raw);
              const entries = Object.entries(state.entries)
                .map(([id, entry]) => ({ id, ...entry }))
                .sort(
                  (a, b) =>
                    a.day.localeCompare(b.day) ||
                    (a.time ?? "").localeCompare(b.time ?? "") ||
                    a.order - b.order,
                );
              return {
                data: { calendarId, entries },
                message: `Calendar "${calendarId}" has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`,
              };
            }

            const calendars = (await document.state.list())
              .filter((row) => row.stateKey.startsWith("calendar:"))
              .map((row) => {
                const parsed = calendarStateSchema.safeParse(row.state);
                return {
                  calendarId: row.stateKey.slice("calendar:".length),
                  entryCount: parsed.success
                    ? Object.keys(parsed.data.entries).length
                    : 0,
                };
              });
            return {
              data: { calendars },
              message: `This document has ${calendars.length} calendar${calendars.length === 1 ? "" : "s"}.`,
            };
          },
        },
        {
          id: "vault.calendar.addEntry",
          title: "Add a calendar entry",
          description:
            "Add a task or event to an existing calendar in a document, on a given day. Use listEntries first to find the calendarId.",
          scope: "document",
          mutates: true,
          permissions: ["document:write-extension-state"],
          input: addEntryInputSchema,
          async handler(input, context) {
            const document = context.document;
            if (!document) {
              throw new Error("This action requires a document.");
            }

            const args = input as z.infer<typeof addEntryInputSchema>;
            const stateKey = `calendar:${args.calendarId}`;

            const existing = (await document.state.list()).find(
              (row) => row.stateKey === stateKey,
            );
            const current = existing
              ? calendarStateSchema.parse(existing.state)
              : calendarStateSchema.parse({});

            const id = crypto.randomUUID();
            const sameDayCount = Object.values(current.entries).filter(
              (entry) => entry.day === args.day,
            ).length;

            const entry: CalendarEntry = {
              type: args.type,
              day: args.day,
              text: args.text,
              order: sameDayCount,
              ...(args.type === "task" ? { done: false } : {}),
              ...(args.time ? { time: args.time } : {}),
              ...(args.note ? { note: args.note } : {}),
            };

            const next = calendarStateSchema.parse({
              ...current,
              entries: { ...current.entries, [id]: entry },
            });

            await document.state.set(next, {
              stateKey,
              version: 1,
              visibility: existing?.visibility ?? "private",
            });

            return {
              data: { entryId: id },
              message: `Added ${args.type} "${args.text}" to ${args.day} in calendar "${args.calendarId}".`,
            };
          },
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
