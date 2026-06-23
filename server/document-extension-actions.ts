"use server";

import { z } from "zod";

import {
  deleteDocumentExtensionStateForUser,
  getDocumentExtensionStateForUser,
  listDocumentExtensionStatesForUser,
  upsertDocumentExtensionStateForUser,
  type DocumentExtensionStateValue,
} from "@/server/document-extensions";
import { requireActiveUser } from "@/server/authz";

const documentIdSchema = z.string().uuid();

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
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i)
  .optional();

const stateVisibilitySchema = z
  .enum(["private", "public", "editor-only"])
  .optional();

const extensionStateActionSchema = z.object({
  documentId: documentIdSchema,
  extensionId: extensionIdSchema,
  stateKey: stateKeySchema,
});

const upsertExtensionStateActionSchema = extensionStateActionSchema.extend({
  state: z.record(z.string(), z.unknown()),
  version: z.number().int().positive().optional(),
  visibility: stateVisibilitySchema,
});

export type DocumentExtensionStateActionRecord = {
  extensionId: string;
  stateKey: string;
  state: DocumentExtensionStateValue;
  version: number;
  visibility: "private" | "public" | "editor-only";
  updatedAt: string;
};

function toActionRecord(row: {
  extensionId: string;
  stateKey: string;
  state: unknown;
  version: number;
  visibility: "private" | "public" | "editor-only";
  updatedAt: Date;
}): DocumentExtensionStateActionRecord {
  return {
    extensionId: row.extensionId,
    stateKey: row.stateKey,
    state: row.state as DocumentExtensionStateValue,
    version: row.version,
    visibility: row.visibility,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDocumentExtensionStateAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = extensionStateActionSchema.parse(input);
  const row = await getDocumentExtensionStateForUser({
    userId: user.id,
    ...parsed,
  });

  return row ? toActionRecord(row) : null;
}

export async function listDocumentExtensionStatesAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = z
    .object({
      documentId: documentIdSchema,
      extensionId: extensionIdSchema.optional(),
    })
    .parse(input);

  const rows = await listDocumentExtensionStatesForUser({
    userId: user.id,
    ...parsed,
  });

  return rows.map(toActionRecord);
}

export async function upsertDocumentExtensionStateAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = upsertExtensionStateActionSchema.parse(input);
  const row = await upsertDocumentExtensionStateForUser({
    userId: user.id,
    ...parsed,
  });

  return toActionRecord(row);
}

export async function deleteDocumentExtensionStateAction(input: unknown) {
  const user = await requireActiveUser();
  const parsed = extensionStateActionSchema.parse(input);
  const row = await deleteDocumentExtensionStateForUser({
    userId: user.id,
    ...parsed,
  });

  return row ? toActionRecord(row) : null;
}
