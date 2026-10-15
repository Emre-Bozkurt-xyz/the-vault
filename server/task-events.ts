import "server-only";

import { eq, sql } from "drizzle-orm";

import { client, db } from "@/db";
import { documents } from "@/db/schema";

/**
 * Live task-change notices (docs/24_TASKS_AND_AGENDA_PLAN.md §5.4).
 *
 * Every task surface is a query over Markdown, so "something changed" is all a
 * client needs to hear; it then refetches through the lazy index, which only
 * reparses the documents that moved. Notices travel on one Postgres channel:
 *
 * - `scripts/collab-server.mjs` notifies after a debounced store **when the
 *   document's task lines changed** (it keeps a per-document signature), so
 *   ordinary typing stays silent;
 * - task writes in this process (`applyTaskChange`, capture, delete, undo)
 *   notify as soon as they land, ahead of that store.
 *
 * Payload: `{"o": ownerId, "d": documentId}`. Personal scope means only the
 * owner's tabs are told — the same rule as the index.
 */
export const TASK_EVENTS_CHANNEL = "vault_tasks_changed";

export type TaskSourceChange = { documentId: string };
type Listener = (change: TaskSourceChange) => void;

type Bus = {
  listeners: Map<string, Set<Listener>>;
  /** The LISTEN request, started on first subscribe; postgres.js reconnects it. */
  listening: Promise<unknown> | null;
};

// On globalThis so dev-mode module reloads reuse one LISTEN connection.
const globalBus = globalThis as typeof globalThis & { __vaultTaskEvents?: Bus };
const bus: Bus = (globalBus.__vaultTaskEvents ??= { listeners: new Map(), listening: null });

function dispatch(payload: string) {
  let parsed: { o?: unknown; d?: unknown };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return;
  }
  if (typeof parsed.o !== "string" || typeof parsed.d !== "string") return;

  for (const listener of bus.listeners.get(parsed.o) ?? []) {
    try {
      listener({ documentId: parsed.d });
    } catch (error) {
      console.error("Task event listener failed", error);
    }
  }
}

/**
 * Calls `listener` for each task-source change in a document `userId` owns.
 * One Postgres LISTEN connection serves every subscriber in this process.
 */
export function subscribeToTaskSourceChanges(userId: string, listener: Listener): () => void {
  if (!bus.listening) {
    bus.listening = client.listen(TASK_EVENTS_CHANNEL, dispatch).catch((error: unknown) => {
      console.error("Could not listen for task changes", error);
      bus.listening = null;
    });
  }

  let set = bus.listeners.get(userId);
  if (!set) bus.listeners.set(userId, (set = new Set()));
  set.add(listener);

  return () => {
    set.delete(listener);
    if (set.size === 0) bus.listeners.delete(userId);
  };
}

/** Tells the owner's open task surfaces that `documentId`'s tasks changed. Never throws. */
export async function notifyTaskSourceChanged(documentId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ ownerId: documents.ownerId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!row) return;
    const payload = JSON.stringify({ o: row.ownerId, d: documentId });
    await db.execute(sql`select pg_notify(${TASK_EVENTS_CHANNEL}, ${payload})`);
  } catch (error) {
    console.error("Could not announce a task change", error);
  }
}
