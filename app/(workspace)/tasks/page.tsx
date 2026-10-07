import { TasksPage } from "@/components/tasks/TasksPage";
import { getWorkspaceData } from "@/server/workspace";

/**
 * The Tasks page (docs/24_TASKS_AND_AGENDA_PLAN.md §6.2). Everything else is
 * fetched client-side through `getTaskPageAction`, so the page can refresh
 * after each tick or reschedule without a navigation.
 */
export default async function TasksRoute() {
  const workspace = await getWorkspaceData();

  return (
    <TasksPage
      enabled={workspace.tasksEnabled}
      folders={workspace.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      }))}
    />
  );
}
