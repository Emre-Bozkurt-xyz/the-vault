import "server-only";
import postgres from "postgres";
import { connectionString } from "@/db";

// Separate pool: the write callback needs the main DB pool while this transaction waits.
const locks = postgres(connectionString, { max: 4, prepare: false });

/** Serialize source-dependent writes across server processes, releasing on error too. */
export async function withDocumentWriteLock<T>(
  documentId: string,
  write: () => Promise<T>,
): Promise<T> {
  const result: T[] = [];
  await locks.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"task_write:" + documentId}))`;
    result.push(await write());
  });
  return result[0];
}
