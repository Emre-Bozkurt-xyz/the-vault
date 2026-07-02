"use server";

import { revalidatePath } from "next/cache";

import { SNIPPET_LIMITS } from "@/lib/config/snippet-limits";
import { checkRateLimit } from "@/lib/rate-limit";
import { compileSnippet, type SnippetDiagnostic } from "@/lib/snippets/compile";
import { requireActiveUser } from "@/server/authz";
import {
  attachSnippetToDocument,
  createSnippetForUser,
  deleteSnippetForUser,
  detachSnippetFromDocument,
  getSnippetForUser,
  listDocumentSnippetAttachmentsForOwner,
  listSnippetsForUser,
  reorderDocumentSnippets,
  updateSnippetForUser,
} from "@/server/snippets";
import { upsertUserSetting } from "@/server/user-settings";

export async function listSnippetsAction() {
  const user = await requireActiveUser();
  return listSnippetsForUser(user.id);
}

export async function getSnippetDetailAction(snippetId: string) {
  const user = await requireActiveUser();
  return getSnippetForUser(user.id, snippetId);
}

export async function createSnippetAction(input: {
  name: string;
  description?: string;
}) {
  const user = await requireActiveUser();
  return createSnippetForUser(user.id, input);
}

/** Global viewer opt-out: whether to apply CSS styling authored by others. */
export async function setViewerStylingPreferenceAction(apply: boolean) {
  const user = await requireActiveUser();
  await upsertUserSetting({
    userId: user.id,
    namespace: "appearance",
    key: "snippets",
    value: { applyAuthorStyling: apply },
  });
  return { ok: true as const };
}

export async function updateSnippetAction(
  snippetId: string,
  input: { name?: string; description?: string | null; sourceCss?: string },
) {
  const user = await requireActiveUser();
  return updateSnippetForUser(user.id, snippetId, input);
}

export async function deleteSnippetAction(snippetId: string) {
  const user = await requireActiveUser();
  return deleteSnippetForUser(user.id, snippetId);
}

/**
 * Compile-only preview for the snippet editor. Never persists; rate-limited per
 * user because CSS parsing is CPU-bearing. Always returns the sanitized result
 * so the author sees exactly what viewers would (including dropped rules).
 */
export async function compileSnippetPreviewAction(sourceCss: string): Promise<{
  ok: boolean;
  css: string;
  diagnostics: SnippetDiagnostic[];
  rateLimited?: boolean;
}> {
  const user = await requireActiveUser();

  const limit = checkRateLimit(
    `snippet-compile:${user.id}`,
    SNIPPET_LIMITS.compileRateLimit,
    SNIPPET_LIMITS.compileRateWindowMs,
  );
  if (!limit.ok) {
    return {
      ok: false,
      css: "",
      diagnostics: [
        {
          severity: "error",
          message: "Too many preview compiles; slow down a moment.",
        },
      ],
      rateLimited: true,
    };
  }

  if (sourceCss.length > SNIPPET_LIMITS.maxSourceBytes * 2) {
    return {
      ok: false,
      css: "",
      diagnostics: [{ severity: "error", message: "Snippet is too large" }],
    };
  }

  return compileSnippet(sourceCss);
}

export async function listDocumentSnippetAttachmentsAction(documentId: string) {
  const user = await requireActiveUser();
  return listDocumentSnippetAttachmentsForOwner(user.id, documentId);
}

export async function attachSnippetAction(
  documentId: string,
  snippetId: string,
) {
  const user = await requireActiveUser();
  const result = await attachSnippetToDocument(user.id, documentId, snippetId);
  if (result.ok) {
    revalidatePath(`/docs/${documentId}`);
  }
  return result;
}

export async function detachSnippetAction(
  documentId: string,
  snippetId: string,
) {
  const user = await requireActiveUser();
  const result = await detachSnippetFromDocument(user.id, documentId, snippetId);
  if (result.ok) {
    revalidatePath(`/docs/${documentId}`);
  }
  return result;
}

export async function reorderDocumentSnippetsAction(
  documentId: string,
  orderedSnippetIds: string[],
) {
  const user = await requireActiveUser();
  const result = await reorderDocumentSnippets(
    user.id,
    documentId,
    orderedSnippetIds,
  );
  if (result.ok) {
    revalidatePath(`/docs/${documentId}`);
  }
  return result;
}
