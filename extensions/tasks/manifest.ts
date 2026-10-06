import { defineManifest } from "@/lib/extension-api";
import { z } from "zod";

const tasksSettingsSchema = z.object({
  inboxDocumentId: z.string().uuid().nullable().default(null),
  captureTarget: z.enum(["inbox", "daily-note"]).default("inbox"),
});

/**
 * Task *syntax* (`[/]`, `:due[…]`) is core Markdown and renders for every
 * viewer whether or not this is on. docs/24_TASKS_AND_AGENDA_PLAN.md
 *
 * The SDK has no workspace-panel contribution yet, so the agenda panel lives in
 * core (`components/workspace/WorkspaceTasksPanel.tsx`). The server module owns
 * agent actions through the SDK's permission-checked task service.
 */
export default defineManifest({
  id: "vault.tasks",
  name: "Tasks",
  version: 1,
  category: "workspace",
  description:
    "An agenda of the task lines in your documents: what is overdue, due today and coming up, gathered from every note you own.",
  defaultEnabled: false,
  permissions: ["document:read", "document:write", "workspace:panel"],
  settings: {
    schema: tasksSettingsSchema,
    defaults: { inboxDocumentId: null, captureTarget: "inbox" },
    sections: [{
      id: "capture", label: "Capture",
      fields: [{
        type: "select", key: "captureTarget", label: "Quick capture destination",
        description: "Use the Inbox or today's date-titled note. A daily note is created at the root when needed.",
        options: [
          { value: "inbox", label: "Inbox" },
          { value: "daily-note", label: "Daily note" },
        ],
      }, {
        type: "document", key: "inboxDocumentId", label: "Inbox document",
        description: "Used when the destination is Inbox. Choose one you own, or let Vault create an Inbox when you next capture.",
        emptyLabel: "Create an Inbox automatically",
      }],
    }],
  },
  syntax: { blocks: ["tasks"], documentSourceBlocks: ["tasks"] },
  slashCommands: [
    {
      id: "vault.tasks.slash-query",
      label: "tasks",
      title: "Task list",
      keywords: "agenda todo checklist query due week",
      directive: "tasks",
      insert: { markdown: ":::tasks{due=week}" },
    },
  ],
});
