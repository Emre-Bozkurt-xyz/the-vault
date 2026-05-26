import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { documentPermissions, documents, type DocumentRole } from "@/db/schema";

export type DocumentAccess = {
  canRead: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  canPublish: boolean;
  role: DocumentRole | null;
};

const noAccess: DocumentAccess = {
  canRead: false,
  canEdit: false,
  canShare: false,
  canDelete: false,
  canPublish: false,
  role: null,
};

export async function getDocumentAccess(
  userId: string | null,
  documentId: string,
): Promise<DocumentAccess> {
  const [document] = await db
    .select({
      ownerId: documents.ownerId,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return noAccess;
  }

  if (document.visibility === "public" && !userId) {
    return {
      ...noAccess,
      canRead: true,
    };
  }

  if (!userId) {
    return noAccess;
  }

  if (document.ownerId === userId) {
    return {
      canRead: true,
      canEdit: true,
      canShare: true,
      canDelete: true,
      canPublish: true,
      role: "owner",
    };
  }

  const [permission] = await db
    .select({ role: documentPermissions.role })
    .from(documentPermissions)
    .where(
      and(
        eq(documentPermissions.documentId, documentId),
        eq(documentPermissions.userId, userId),
      ),
    )
    .limit(1);

  if (!permission) {
    return document.visibility === "public"
      ? {
          ...noAccess,
          canRead: true,
        }
      : noAccess;
  }

  const canEdit = permission.role === "owner" || permission.role === "editor";
  const isOwner = permission.role === "owner";

  return {
    canRead: true,
    canEdit,
    canShare: isOwner,
    canDelete: isOwner,
    canPublish: isOwner,
    role: permission.role,
  };
}

export async function canReadDocument(userId: string | null, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canRead;
}

export async function canEditDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canEdit;
}

export async function canShareDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canShare;
}

export async function canDeleteDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canDelete;
}

export async function canPublishDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canPublish;
}
