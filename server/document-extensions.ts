import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  documentExtensionStates,
  documents,
  type DocumentExtensionStateVisibility,
} from "@/db/schema";
import {
  getDocumentAccess,
  type DocumentAccess,
} from "@/lib/permissions";

export type DocumentExtensionStateValue = Record<string, unknown>;

export type DocumentExtensionStateRecord = typeof documentExtensionStates.$inferSelect;

const defaultStateKey = "default";

const extensionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

const stateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i);

const extensionStateValueSchema = z.record(z.string(), z.unknown());

function normalizeExtensionId(extensionId: string) {
  return extensionIdSchema.parse(extensionId);
}

function normalizeStateKey(stateKey?: string) {
  return stateKeySchema.parse(stateKey ?? defaultStateKey);
}

function canReadExtensionState(
  access: DocumentAccess,
  userId: string | null,
  visibility: DocumentExtensionStateVisibility,
) {
  if (!access.canRead) {
    return false;
  }

  if (visibility === "public") {
    return true;
  }

  if (visibility === "editor-only") {
    return access.canEdit;
  }

  return Boolean(userId && access.role);
}

function filterReadableStates(
  rows: DocumentExtensionStateRecord[],
  access: DocumentAccess,
  userId: string | null,
) {
  return rows.filter((row) =>
    canReadExtensionState(access, userId, row.visibility),
  );
}

export async function getDocumentExtensionStateForUser(input: {
  userId: string | null;
  documentId: string;
  extensionId: string;
  stateKey?: string;
}) {
  const extensionId = normalizeExtensionId(input.extensionId);
  const stateKey = normalizeStateKey(input.stateKey);
  const access = await getDocumentAccess(input.userId, input.documentId);

  if (!access.canRead) {
    return null;
  }

  const [row] = await db
    .select()
    .from(documentExtensionStates)
    .where(
      and(
        eq(documentExtensionStates.documentId, input.documentId),
        eq(documentExtensionStates.extensionId, extensionId),
        eq(documentExtensionStates.stateKey, stateKey),
        isNull(documentExtensionStates.deletedAt),
      ),
    )
    .limit(1);

  if (
    !row ||
    !canReadExtensionState(access, input.userId, row.visibility)
  ) {
    return null;
  }

  return row;
}

export async function listDocumentExtensionStatesForUser(input: {
  userId: string | null;
  documentId: string;
  extensionId?: string;
}) {
  const extensionId = input.extensionId
    ? normalizeExtensionId(input.extensionId)
    : null;
  const access = await getDocumentAccess(input.userId, input.documentId);

  if (!access.canRead) {
    return [];
  }

  const rows = await db
    .select()
    .from(documentExtensionStates)
    .where(
      and(
        eq(documentExtensionStates.documentId, input.documentId),
        extensionId
          ? eq(documentExtensionStates.extensionId, extensionId)
          : undefined,
        isNull(documentExtensionStates.deletedAt),
      ),
    )
    .orderBy(documentExtensionStates.extensionId, documentExtensionStates.stateKey);

  return filterReadableStates(rows, access, input.userId);
}

export async function upsertDocumentExtensionStateForUser(input: {
  userId: string;
  documentId: string;
  extensionId: string;
  stateKey?: string;
  state: DocumentExtensionStateValue;
  version?: number;
  visibility?: DocumentExtensionStateVisibility;
}) {
  const access = await getDocumentAccess(input.userId, input.documentId);

  if (!access.canEdit) {
    throw new Error("You do not have permission to update this document extension state.");
  }

  const extensionId = normalizeExtensionId(input.extensionId);
  const stateKey = normalizeStateKey(input.stateKey);
  const state = extensionStateValueSchema.parse(input.state);
  const version = input.version ?? 1;
  const visibility = input.visibility ?? "private";

  const [row] = await db
    .insert(documentExtensionStates)
    .values({
      documentId: input.documentId,
      extensionId,
      stateKey,
      state,
      version,
      visibility,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [
        documentExtensionStates.documentId,
        documentExtensionStates.extensionId,
        documentExtensionStates.stateKey,
      ],
      set: {
        state,
        version,
        visibility,
        updatedBy: input.userId,
        updatedAt: sql`now()`,
        deletedAt: null,
      },
    })
    .returning();

  return row;
}

export async function deleteDocumentExtensionStateForUser(input: {
  userId: string;
  documentId: string;
  extensionId: string;
  stateKey?: string;
}) {
  const access = await getDocumentAccess(input.userId, input.documentId);

  if (!access.canEdit) {
    throw new Error("You do not have permission to delete this document extension state.");
  }

  const extensionId = normalizeExtensionId(input.extensionId);
  const stateKey = normalizeStateKey(input.stateKey);

  const [row] = await db
    .update(documentExtensionStates)
    .set({
      updatedBy: input.userId,
      updatedAt: sql`now()`,
      deletedAt: sql`now()`,
    })
    .where(
      and(
        eq(documentExtensionStates.documentId, input.documentId),
        eq(documentExtensionStates.extensionId, extensionId),
        eq(documentExtensionStates.stateKey, stateKey),
        isNull(documentExtensionStates.deletedAt),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * All of a user's extension-state rows for one extension, across every document
 * they own. Owner-scoped (no sharing) so it needs no per-document access check —
 * the backing surface for `scope: "workspace"` agent actions that aggregate an
 * extension's data across documents.
 */
export async function listOwnedDocumentExtensionStates(input: {
  userId: string;
  extensionId: string;
}) {
  const extensionId = normalizeExtensionId(input.extensionId);

  return db
    .select({
      documentId: documentExtensionStates.documentId,
      documentTitle: documents.title,
      stateKey: documentExtensionStates.stateKey,
      state: documentExtensionStates.state,
      version: documentExtensionStates.version,
      visibility: documentExtensionStates.visibility,
      updatedAt: documentExtensionStates.updatedAt,
    })
    .from(documentExtensionStates)
    .innerJoin(documents, eq(documents.id, documentExtensionStates.documentId))
    .where(
      and(
        eq(documents.ownerId, input.userId),
        eq(documentExtensionStates.extensionId, extensionId),
        isNull(documents.deletedAt),
        isNull(documentExtensionStates.deletedAt),
      ),
    )
    .orderBy(documents.title, documentExtensionStates.stateKey);
}

export async function listPublicDocumentExtensionStates(input: {
  documentId: string;
  extensionId?: string;
}) {
  const extensionId = input.extensionId
    ? normalizeExtensionId(input.extensionId)
    : null;

  return db
    .select({
      id: documentExtensionStates.id,
      documentId: documentExtensionStates.documentId,
      extensionId: documentExtensionStates.extensionId,
      stateKey: documentExtensionStates.stateKey,
      state: documentExtensionStates.state,
      version: documentExtensionStates.version,
      visibility: documentExtensionStates.visibility,
      createdBy: documentExtensionStates.createdBy,
      updatedBy: documentExtensionStates.updatedBy,
      createdAt: documentExtensionStates.createdAt,
      updatedAt: documentExtensionStates.updatedAt,
      deletedAt: documentExtensionStates.deletedAt,
    })
    .from(documentExtensionStates)
    .innerJoin(documents, eq(documents.id, documentExtensionStates.documentId))
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.visibility, "public"),
        isNull(documents.deletedAt),
        eq(documentExtensionStates.visibility, "public"),
        extensionId
          ? eq(documentExtensionStates.extensionId, extensionId)
          : undefined,
        isNull(documentExtensionStates.deletedAt),
      ),
    )
    .orderBy(documentExtensionStates.extensionId, documentExtensionStates.stateKey);
}
