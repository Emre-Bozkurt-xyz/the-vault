import { z } from "zod";

import { defineManifest } from "@/lib/extension-api";

export const calendarSettingsSchema = z.object({
  defaultVisibility: z
    .enum(["private", "editor-only", "public"])
    .default("private"),
  weekStartsOn: z.enum(["0", "1"]).default("0"),
});

export default defineManifest({
  id: "vault.calendar",
  name: "Calendar",
  version: 1,
  category: "document",
  description:
    "Embed a month calendar to track day-scoped tasks and event reminders inside a document.",
  defaultEnabled: false,
  permissions: [
    "document:read",
    "document:write",
    "document:write-extension-state",
  ],
  syntax: { blocks: ["calendar"] },
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
  slashCommands: [
    {
      id: "vault.calendar.slash",
      label: "calendar",
      title: "Calendar",
      keywords: "month tasks events reminder schedule",
      directive: "calendar",
      // Runs the editor module's command, which mints a fresh calendar id.
      run: { command: "vault.calendar.insert" },
    },
  ],
  commands: [
    {
      id: "vault.calendar.insert",
      label: "Insert calendar",
      description: "Insert a month calendar block at the cursor.",
    },
  ],
});
