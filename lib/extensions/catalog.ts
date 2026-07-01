import { z } from "zod";

import {
  calendarStateKey,
  formatCalendarFence,
  generateCalendarId,
} from "@/lib/calendar";
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

/** Sticker size bounds, mirrored from the interactive layer (StickerLayer.tsx). */
const STICKER_MIN_SIZE = 40;
const STICKER_MAX_SIZE = 500;

const addStickerInputSchema = z.object({
  assetId: z
    .string()
    .uuid()
    .describe("An image asset the user owns (from search_assets)."),
  left: z
    .number()
    .default(80)
    .describe("Horizontal position in document-layer pixels."),
  top: z
    .number()
    .default(240)
    .describe("Vertical position in document-layer pixels."),
  width: z
    .number()
    .min(STICKER_MIN_SIZE)
    .max(STICKER_MAX_SIZE)
    .default(120)
    .describe("Sticker size in pixels (square)."),
  rotation: z
    .number()
    .default(0)
    .describe("Clockwise rotation in degrees."),
});

const addStickerOutputSchema = z.object({
  stickerId: z.string().describe("Id of the placed sticker."),
});

const removeStickerInputSchema = z.object({
  stickerId: z
    .string()
    .min(1)
    .describe("The sticker id to remove (from vault.stickers.list)."),
});

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

const addEntryOutputSchema = z.object({
  entryId: z.string().describe("Id of the created entry."),
});

const insertCalendarInputSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe(
      "Place the calendar within this heading's section (matched by text or slug). Omit to append at the document end.",
    ),
  position: z
    .enum(["section_start", "section_end"])
    .default("section_end")
    .describe("Where within the heading's section to place it."),
});

const insertCalendarOutputSchema = z.object({
  calendarId: z
    .string()
    .describe("Id of the new calendar; use it with addEntry/listEntries."),
});

const listUpcomingTasksInputSchema = z.object({
  from: z
    .string()
    .regex(dayKeyPattern)
    .optional()
    .describe("Only include tasks on/after this day (YYYY-MM-DD)."),
  to: z
    .string()
    .regex(dayKeyPattern)
    .optional()
    .describe("Only include tasks on/before this day (YYYY-MM-DD)."),
  includeDone: z
    .boolean()
    .default(false)
    .describe("Include completed tasks (default false)."),
});

const upcomingTaskSchema = z.object({
  documentId: z.string(),
  documentTitle: z.string(),
  calendarId: z.string(),
  entryId: z.string(),
  day: z.string(),
  text: z.string(),
  done: z.boolean(),
});

const listUpcomingTasksOutputSchema = z.object({
  tasks: z.array(upcomingTaskSchema),
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
      "document:write",
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
              const raw = await document.state.get(calendarStateKey(calendarId));
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
          output: addEntryOutputSchema,
          async handler(input, context) {
            const document = context.document;
            if (!document) {
              throw new Error("This action requires a document.");
            }

            const args = input as z.infer<typeof addEntryInputSchema>;
            const stateKey = calendarStateKey(args.calendarId);

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
        {
          id: "vault.calendar.insertCalendar",
          title: "Insert a calendar",
          description:
            "Create a new, empty month calendar in a document by inserting its block into the markdown. Returns the new calendarId to use with addEntry. Appends at the document end, or into a heading's section if given.",
          scope: "document",
          mutates: true,
          permissions: ["document:write"],
          input: insertCalendarInputSchema,
          output: insertCalendarOutputSchema,
          async handler(input, context) {
            const markdown = context.document?.markdown;
            if (!markdown?.append || !markdown.insertAtHeading) {
              throw new Error("This action requires document write access.");
            }

            const { heading, position } = input as z.infer<
              typeof insertCalendarInputSchema
            >;
            const calendarId = generateCalendarId();
            const fence = formatCalendarFence(calendarId);

            if (heading) {
              const { inserted } = await markdown.insertAtHeading(
                heading,
                fence,
                position,
              );
              if (!inserted) {
                throw new Error(`No heading matching "${heading}" was found.`);
              }
            } else {
              await markdown.append(fence);
            }

            return {
              data: { calendarId },
              message: `Inserted a calendar (id "${calendarId}").`,
            };
          },
        },
        {
          id: "vault.calendar.listUpcomingTasks",
          title: "List upcoming calendar tasks",
          description:
            "Across all your documents, list calendar tasks — optionally within a day range and excluding completed ones. Useful for a daily digest of what's due.",
          scope: "workspace",
          mutates: false,
          permissions: ["document:read"],
          input: listUpcomingTasksInputSchema,
          output: listUpcomingTasksOutputSchema,
          async handler(input, context) {
            const workspaceState = context.workspace?.state;
            if (!workspaceState) {
              throw new Error("This action requires read access.");
            }

            const { from, to, includeDone } = input as z.infer<
              typeof listUpcomingTasksInputSchema
            >;

            const rows = await workspaceState.listAcrossDocuments();
            const tasks: Array<z.infer<typeof upcomingTaskSchema>> = [];

            for (const row of rows) {
              if (!row.stateKey.startsWith("calendar:")) continue;
              const calendarId = row.stateKey.slice("calendar:".length);
              const parsed = calendarStateSchema.safeParse(row.state);
              if (!parsed.success) continue;

              for (const [entryId, entry] of Object.entries(
                parsed.data.entries,
              )) {
                if (entry.type !== "task") continue;
                const done = entry.done ?? false;
                if (done && !includeDone) continue;
                if (from && entry.day < from) continue;
                if (to && entry.day > to) continue;

                tasks.push({
                  documentId: row.documentId,
                  documentTitle: row.documentTitle,
                  calendarId,
                  entryId,
                  day: entry.day,
                  text: entry.text,
                  done,
                });
              }
            }

            tasks.sort(
              (a, b) => a.day.localeCompare(b.day) || a.text.localeCompare(b.text),
            );

            return {
              data: { tasks },
              message: `${tasks.length} task${tasks.length === 1 ? "" : "s"} found.`,
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
    agent: {
      actions: [
        {
          id: "vault.stickers.listStickers",
          title: "List stickers",
          description:
            "List the asset-backed stickers placed on a document, with each sticker's id, asset, position, size, and rotation.",
          scope: "document",
          mutates: false,
          permissions: ["document:read"],
          input: z.object({}),
          async handler(_input, context) {
            const document = context.document;
            if (!document) {
              throw new Error("This action requires a document.");
            }

            const raw = await document.state.get("layout");
            if (!raw) {
              return { data: { stickers: [] }, message: "No stickers." };
            }
            const state = stickersStateSchema.parse(raw);
            const stickers = Object.entries(state.items).map(([id, item]) => ({
              id,
              ...item,
            }));
            return {
              data: { stickers },
              message: `${stickers.length} sticker${stickers.length === 1 ? "" : "s"}.`,
            };
          },
        },
        {
          id: "vault.stickers.addSticker",
          title: "Add a sticker",
          description:
            "Place an image asset the user owns as a sticker on a document at an optional position/size/rotation. Find asset ids with search_assets.",
          scope: "document",
          mutates: true,
          permissions: ["document:write-extension-state", "asset:read"],
          input: addStickerInputSchema,
          output: addStickerOutputSchema,
          async handler(input, context) {
            const document = context.document;
            if (!document?.assets) {
              throw new Error("This action requires a document and asset access.");
            }

            const args = input as z.infer<typeof addStickerInputSchema>;
            const asset = await document.assets.get(args.assetId);
            if (!asset) {
              throw new Error("Asset not found, not ready, or not owned by you.");
            }
            if (asset.kind !== "image") {
              throw new Error("Only image assets can be used as stickers.");
            }

            const existing = (await document.state.list()).find(
              (row) => row.stateKey === "layout",
            );
            const current = existing
              ? stickersStateSchema.parse(existing.state)
              : stickersStateSchema.parse({});

            const id = `s_${Date.now().toString(36)}_${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            const item: StickerItem = {
              assetId: args.assetId,
              left: args.left,
              top: args.top,
              width: args.width,
              rotation: args.rotation,
            };

            const next = stickersStateSchema.parse({
              items: { ...current.items, [id]: item },
            });

            // The interactive layer persists the layout as `public` so stickers
            // render on published pages; preserve an existing visibility, else match.
            await document.state.set(next, {
              stateKey: "layout",
              version: 1,
              visibility: existing?.visibility ?? "public",
            });

            return {
              data: { stickerId: id },
              message: `Added sticker "${asset.displayName}" to the document.`,
            };
          },
        },
        {
          id: "vault.stickers.removeSticker",
          title: "Remove a sticker",
          description:
            "Remove a sticker from a document by its id (from listStickers).",
          scope: "document",
          mutates: true,
          permissions: ["document:write-extension-state"],
          input: removeStickerInputSchema,
          async handler(input, context) {
            const document = context.document;
            if (!document) {
              throw new Error("This action requires a document.");
            }

            const { stickerId } = input as z.infer<
              typeof removeStickerInputSchema
            >;
            const existing = (await document.state.list()).find(
              (row) => row.stateKey === "layout",
            );
            if (!existing) {
              return { message: "This document has no stickers." };
            }

            const current = stickersStateSchema.parse(existing.state);
            if (!current.items[stickerId]) {
              return { message: `No sticker "${stickerId}" on this document.` };
            }

            const rest = { ...current.items };
            delete rest[stickerId];
            const next = stickersStateSchema.parse({ items: rest });
            await document.state.set(next, {
              stateKey: "layout",
              version: 1,
              visibility: existing.visibility,
            });

            return {
              data: { removed: stickerId },
              message: `Removed sticker "${stickerId}".`,
            };
          },
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
