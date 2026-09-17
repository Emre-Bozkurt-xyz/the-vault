"use server";

import { requireActiveUser } from "@/server/authz";
import {
  createDefinitionForUser,
  listOwnedFolderOptionsForUser,
  type CreateDefinitionResult,
} from "@/server/definitions-data";

/**
 * Session-resolving server actions for the dictionary extension
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md`).
 *
 * Every export here is a callable endpoint, so each one resolves the acting user
 * itself and never accepts a user id. The data access they wrap lives in
 * `server/definitions-data.ts`, which is `server-only`.
 */

/** `/def` in the editor. See `createDefinitionForUser`. */
export async function createDefinitionDocumentAction(input: {
  term: string;
  currentFolderId?: string | null;
  preferredFolderId?: string | null;
}): Promise<CreateDefinitionResult> {
  const user = await requireActiveUser();
  return createDefinitionForUser(user.id, input);
}

/** The signed-in user's own folders, for the definition folder picker. */
export async function listDefinitionFolderOptions() {
  const user = await requireActiveUser();
  return listOwnedFolderOptionsForUser(user.id);
}
