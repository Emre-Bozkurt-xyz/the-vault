import { shareInFlight } from "@/lib/shared-request";
import { getTaskAgendaAction, type TaskAgendaResult } from "@/server/tasks";

/**
 * The viewer's agenda for `today`, with concurrent requests shared: the Tasks
 * panel and the home Today section both reload on the same "tasks changed"
 * event and would otherwise compute the same agenda twice. The viewer is the
 * session user, so the day is the whole key.
 */
export function loadTaskAgenda(today: string): Promise<TaskAgendaResult> {
  return shareInFlight(`task-agenda:${today}`, () =>
    getTaskAgendaAction({ today }),
  );
}
