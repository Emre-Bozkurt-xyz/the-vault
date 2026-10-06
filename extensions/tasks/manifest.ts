import { defineManifest } from "@/lib/extension-api";

/**
 * Surfaces only: the sidebar agenda, the agent actions in `server.ts`, and later
 * the Tasks page, capture and query blocks. Task *syntax* (`[/]`, `:due[…]`) is
 * core Markdown and renders for every viewer whether or not this is on.
 * docs/24_TASKS_AND_AGENDA_PLAN.md
 *
 * The SDK has no workspace-panel contribution yet, so the agenda panel lives in
 * core (`components/workspace/WorkspaceTasksPanel.tsx`) and this extension's
 * enablement is the switch that shows it. `document:write` is for the agent
 * actions that tick, reschedule, and add tasks.
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
});
