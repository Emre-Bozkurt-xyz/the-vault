import "server-only";

import { and, eq, isNull, like } from "drizzle-orm";

import { db } from "@/db";
import { documentExtensionStates } from "@/db/schema";
import { calendarStateSchema, type CalendarState } from "@/lib/extensions/catalog";

/**
 * Public-visibility calendar states for a published document, keyed by calendar
 * id (the `<id>` in the `calendar:<id>` state key). Used to render calendars on
 * public pages without a client fetch (the state action requires auth).
 */
export async function getPublicCalendarStates(
  documentId: string,
): Promise<Record<string, CalendarState>> {
  const rows = await db
    .select({
      stateKey: documentExtensionStates.stateKey,
      state: documentExtensionStates.state,
    })
    .from(documentExtensionStates)
    .where(
      and(
        eq(documentExtensionStates.documentId, documentId),
        eq(documentExtensionStates.extensionId, "vault.calendar"),
        eq(documentExtensionStates.visibility, "public"),
        like(documentExtensionStates.stateKey, "calendar:%"),
        isNull(documentExtensionStates.deletedAt),
      ),
    );

  const result: Record<string, CalendarState> = {};

  for (const row of rows) {
    const id = row.stateKey.slice("calendar:".length);
    if (!id) continue;

    const parsed = calendarStateSchema.safeParse(row.state);
    if (parsed.success) {
      result[id] = parsed.data;
    }
  }

  return result;
}
