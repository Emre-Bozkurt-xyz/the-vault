"use server";

import {
  dictionarySettingsSchema,
  getLocalExtensionIds,
} from "@/lib/extensions/catalog";
import { requireActiveUser } from "@/server/authz";
import {
  createDefinitionForUser,
  type CreateDefinitionResult,
} from "@/server/definitions-data";
import { getUserExtensionSetting } from "@/server/user-settings";

/**
 * Session-resolving server actions for the dictionary extension
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md`).
 *
 * Every export here is a callable endpoint, so each one resolves the acting user
 * itself and never accepts a user id. The data access they wrap lives in
 * `server/definitions-data.ts`, which is `server-only`.
 */

/**
 * `/def` in the editor. See `createDefinitionForUser`.
 *
 * The configured folder is read here from the user's own Dictionary settings
 * rather than accepted from the client, so the only folder a caller can name is
 * the one the document they are writing in already lives in — and that one is
 * permission-checked downstream too.
 */
export async function createDefinitionDocumentAction(input: {
  term: string;
  summary?: string | null;
  currentFolderId?: string | null;
}): Promise<CreateDefinitionResult> {
  const user = await requireActiveUser();
  const stored = await getUserExtensionSetting({
    userId: user.id,
    extensionId: "vault.dictionary",
    allowedExtensionIds: getLocalExtensionIds(),
  });
  const settings = dictionarySettingsSchema.safeParse(stored?.settings ?? {});

  return createDefinitionForUser(user.id, {
    term: input.term,
    summary: input.summary,
    currentFolderId: input.currentFolderId,
    preferredFolderId: settings.success ? settings.data.newDefinitionFolderId : null,
  });
}
