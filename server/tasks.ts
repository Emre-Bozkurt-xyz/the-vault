"use server";

import { z } from "zod";

import { addDaysToDayKey, isValidDayKey } from "@/lib/tasks/dates";
import { requireActiveUser } from "@/server/authz";
import {
  ensureTaskIndexFresh,
  listAgendaTasks,
  type TaskAgenda,
} from "@/server/tasks-data";
import { getUserExtensionSetting } from "@/server/user-settings";

/** How far ahead the sidebar agenda looks, counting today. */
const agendaHorizonDays = 7;

const agendaInputSchema = z.object({
  /** The viewer's local day. The server clock is never the reference. */
  today: z.string().refine(isValidDayKey, "Must be a real YYYY-MM-DD date."),
});

export type TaskAgendaResult =
  | ({ ok: true; today: string; through: string } & TaskAgenda)
  | { ok: false; error: string };

/**
 * The sidebar agenda: open tasks due through today + 7 days (including every
 * overdue one) from documents the viewer owns. Refreshes the lazy index first.
 */
export async function getTaskAgendaAction(input: unknown): Promise<TaskAgendaResult> {
  const user = await requireActiveUser();
  const parsed = agendaInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid date." };
  }

  const setting = await getUserExtensionSetting({
    userId: user.id,
    extensionId: "vault.tasks",
  });

  if (!setting?.enabled) {
    return { ok: false, error: "Tasks is turned off in Settings → Extensions." };
  }

  const { today } = parsed.data;
  const through = addDaysToDayKey(today, agendaHorizonDays);

  try {
    await ensureTaskIndexFresh(user.id);
    const agenda = await listAgendaTasks(user.id, through);
    return { ok: true, today, through, ...agenda };
  } catch (error) {
    console.error("Failed to load the task agenda", error);
    return { ok: false, error: "Could not load tasks." };
  }
}
