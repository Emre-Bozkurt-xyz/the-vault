import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documentAssets,
  documentPermissions,
  documents,
  groupMembers,
  groups,
  serviceTokens,
  services,
  users,
} from "@/db/schema";
import { getDocumentAccess } from "@/lib/permissions";
import { hashServiceToken } from "@/lib/service-tokens";

/**
 * Group ownership + service-principal domain logic (Den embed bridge,
 * docs/DEN_EMBED_BRIDGE.md §C.7-10, "Design settled 2026-07-27"). Backs the
 * owner-op APIs under `/api/embed/groups` and `/api/embed/documents`, and the
 * workspace file browser's "Services" section.
 *
 * Every route calling into this module has already authenticated the caller
 * as a specific `services` row via a bearer `service_tokens` credential
 * (`resolveServiceBearerToken`) — but that only proves *which service* is
 * calling, never that it may touch a particular group. Every group-scoped
 * function here re-checks `groups.serviceId` against the caller's own
 * `serviceId` (via {@link getServiceOwnedGroup}) so one integrating service
 * can never read/write another's groups or members.
 */

export type ResolvedService = {
  serviceId: string;
  slug: string;
  displayName: string;
  principalUserId: string;
};

/**
 * Resolves a `Bearer` service token to the service it authenticates, or null
 * if the header is missing/malformed, the token is unknown, or either the
 * token or its owning service has been revoked. Mirrors
 * `resolveAccessToken` (`lib/mcp/oauth.ts`) — hash lookup, revocation check,
 * best-effort `last_used_at` bump — but against `service_tokens` instead of
 * `mcp_tokens`, since a service credential is a distinct concept from a
 * user's OAuth token (see docs/DEN_EMBED_BRIDGE.md "Two-tier trust").
 */
export async function resolveServiceBearerToken(
  request: Request,
): Promise<ResolvedService | null> {
  const header =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return null;
  }

  const tokenHash = hashServiceToken(token);

  const [row] = await db
    .select({
      serviceId: services.id,
      slug: services.slug,
      displayName: services.displayName,
      principalUserId: services.principalUserId,
      serviceRevokedAt: services.revokedAt,
      tokenRevokedAt: serviceTokens.revokedAt,
    })
    .from(serviceTokens)
    .innerJoin(services, eq(serviceTokens.serviceId, services.id))
    .where(eq(serviceTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.tokenRevokedAt || row.serviceRevokedAt) {
    return null;
  }

  // Best-effort audit timestamp; never block or fail the request on it.
  void db
    .update(serviceTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(serviceTokens.tokenHash, tokenHash))
    .catch(() => {});

  return {
    serviceId: row.serviceId,
    slug: row.slug,
    displayName: row.displayName,
    principalUserId: row.principalUserId,
  };
}

/**
 * Loads a group only if it exists, is not soft-deleted, and is owned by the
 * calling service. Returns null otherwise — the caller should turn that into
 * an opaque 404, exactly like an unreadable document, so one service can't
 * probe for another's group ids.
 */
export async function getServiceOwnedGroup(serviceId: string, groupId: string) {
  const [group] = await db
    .select({ id: groups.id, name: groups.name, serviceId: groups.serviceId })
    .from(groups)
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
    .limit(1);

  if (!group || group.serviceId !== serviceId) {
    return null;
  }

  return group;
}

/**
 * Whether a user is a member of a group. Used to gate the clone op: the acting
 * user may only clone a document they can read into a group *they belong to*.
 * Without that, a service holding a user's consented OAuth token could copy
 * that user's private documents into a group of strangers — the service can
 * already read the content, but cloning re-exposes it to other people, which
 * is a genuine widening the read scope never granted.
 *
 * This intentionally does not re-check `groups.deleted_at` / `services.revoked_at`;
 * callers reach it through `getServiceOwnedGroup`, which already filters those.
 */
export async function isUserInGroup(userId: string, groupId: string) {
  const [membership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);

  return Boolean(membership);
}

export async function createGroupForService(
  serviceId: string,
  name: string,
): Promise<{ id: string }> {
  const [group] = await db
    .insert(groups)
    .values({ serviceId, name })
    .returning({ id: groups.id });

  return group;
}

async function userExists(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(row);
}

/**
 * Adds a member to a group. Idempotent: re-adding an existing member is a
 * no-op (`onConflictDoNothing` against the `(group_id, user_id)` unique
 * index). Returns false only when `vaultUserId` does not correspond to a
 * real user — the route should treat that as a 404, same as an unknown group.
 */
export async function addGroupMember(
  groupId: string,
  vaultUserId: string,
): Promise<boolean> {
  if (!(await userExists(vaultUserId))) {
    return false;
  }

  await db
    .insert(groupMembers)
    .values({ groupId, userId: vaultUserId })
    .onConflictDoNothing({
      target: [groupMembers.groupId, groupMembers.userId],
    });

  return true;
}

/**
 * Removes a member from a group. Idempotent: removing an absent member is a
 * no-op — this always "succeeds" once the group itself is confirmed to
 * belong to the caller.
 */
export async function removeGroupMember(
  groupId: string,
  vaultUserId: string,
): Promise<void> {
  await db
    .delete(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, vaultUserId)),
    );
}

/**
 * Creates a new document owned by the group (`owning_group_id`), with the
 * service's principal as its structural `ownerId` — see the schema comment
 * on `documents.owningGroupId` for why. Mirrors
 * `createDocumentForUser` (`server/documents.ts`): seeds an empty body and an
 * `owner` `document_permissions` row for the principal.
 */
export async function createGroupOwnedDocument(input: {
  principalUserId: string;
  groupId: string;
  title?: string;
}): Promise<{ id: string }> {
  const title = (input.title?.trim() || "Untitled document").slice(0, 200);

  const [document] = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        ownerId: input.principalUserId,
        owningGroupId: input.groupId,
        title,
        markdown: "",
      })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId: input.principalUserId,
      role: "owner",
    });

    return [createdDocument];
  });

  return { id: document.id };
}

/**
 * Clones a readable document into a group: copies `markdown` and every
 * `document_assets` link row (those rows are themselves access grants —
 * `server/assets.ts` `getReadableAsset` — so group members inherit private
 * asset access for free, exactly like the source document's own viewers do;
 * nothing is stripped).
 *
 * **Clone is user-delegated, not a pure owner op** (contract revision
 * 2026-07-27, docs/DEN_EMBED_BRIDGE.md §4). Read access to the source is
 * checked against `actingUserId` — the human whose OAuth token the calling
 * service presented — never against the service principal. Checking the
 * principal instead (the original implementation) meant a user's own *private*
 * document was unclonable, since the principal cannot read it, which defeated
 * the create-or-clone model entirely. The resulting document is still *owned*
 * by the principal and the group; only the read authorization comes from the
 * acting user.
 *
 * The caller must additionally have confirmed the acting user belongs to the
 * target group (`isUserInGroup`) — see that function for why.
 *
 * Returns null if the source doesn't exist or isn't readable by the acting
 * user — the route turns that into a 404.
 */
export async function cloneDocumentIntoGroup(input: {
  principalUserId: string;
  actingUserId: string;
  groupId: string;
  sourceDocumentId: string;
  title?: string;
}): Promise<{ id: string } | null> {
  const access = await getDocumentAccess(input.actingUserId, input.sourceDocumentId);

  if (!access.canRead) {
    return null;
  }

  const [source] = await db
    .select({ title: documents.title, markdown: documents.markdown })
    .from(documents)
    .where(
      and(eq(documents.id, input.sourceDocumentId), isNull(documents.deletedAt)),
    )
    .limit(1);

  if (!source) {
    return null;
  }

  const title = (input.title?.trim() || source.title || "Untitled document").slice(
    0,
    200,
  );

  const newDocumentId = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        ownerId: input.principalUserId,
        owningGroupId: input.groupId,
        title,
        markdown: source.markdown,
      })
      .returning({ id: documents.id });

    await tx.insert(documentPermissions).values({
      documentId: createdDocument.id,
      userId: input.principalUserId,
      role: "owner",
    });

    const sourceAssetLinks = await tx
      .select({ assetId: documentAssets.assetId })
      .from(documentAssets)
      .where(eq(documentAssets.documentId, input.sourceDocumentId));

    if (sourceAssetLinks.length > 0) {
      await tx
        .insert(documentAssets)
        .values(
          sourceAssetLinks.map((row) => ({
            documentId: createdDocument.id,
            assetId: row.assetId,
            linkedBy: input.principalUserId,
          })),
        )
        .onConflictDoNothing({
          target: [documentAssets.documentId, documentAssets.assetId],
        });
    }

    return createdDocument.id;
  });

  return { id: newDocumentId };
}

export type WorkspaceServiceDocumentItem = {
  id: string;
  title: string;
  href: string;
  updatedAt: Date;
};

export type WorkspaceServiceGroupItem = {
  id: string;
  name: string;
  documents: WorkspaceServiceDocumentItem[];
};

export type WorkspaceServiceItem = {
  id: string;
  slug: string;
  displayName: string;
  icon: string | null;
  groups: WorkspaceServiceGroupItem[];
};

/**
 * Lists every service-owned group a user belongs to, nested Service -> Group
 * -> Documents, for the workspace file browser's generic "Services" section
 * (docs/DEN_EMBED_BRIDGE.md "Design settled" — Service -> Group -> Documents,
 * no service-specific code path). A plain (non-service) group — `serviceId`
 * null — is excluded by the inner join; it isn't part of this UI concept.
 * Membership here is read-only by design: Vault displays it, the owning
 * service owns it.
 */
export async function listServiceGroupsForUser(
  userId: string,
): Promise<WorkspaceServiceItem[]> {
  const rows = await db
    .select({
      serviceId: services.id,
      serviceSlug: services.slug,
      serviceDisplayName: services.displayName,
      serviceIcon: services.icon,
      groupId: groups.id,
      groupName: groups.name,
      documentId: documents.id,
      documentTitle: documents.title,
      documentUpdatedAt: documents.updatedAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .innerJoin(services, eq(groups.serviceId, services.id))
    .leftJoin(
      documents,
      and(eq(documents.owningGroupId, groups.id), isNull(documents.deletedAt)),
    )
    .where(
      and(
        eq(groupMembers.userId, userId),
        isNull(groups.deletedAt),
        isNull(services.revokedAt),
      ),
    );

  const serviceMap = new Map<string, WorkspaceServiceItem>();
  const groupMap = new Map<string, WorkspaceServiceGroupItem>();

  for (const row of rows) {
    let service = serviceMap.get(row.serviceId);
    if (!service) {
      service = {
        id: row.serviceId,
        slug: row.serviceSlug,
        displayName: row.serviceDisplayName,
        icon: row.serviceIcon,
        groups: [],
      };
      serviceMap.set(row.serviceId, service);
    }

    let group = groupMap.get(row.groupId);
    if (!group) {
      group = { id: row.groupId, name: row.groupName, documents: [] };
      groupMap.set(row.groupId, group);
      service.groups.push(group);
    }

    if (row.documentId && row.documentTitle && row.documentUpdatedAt) {
      group.documents.push({
        id: row.documentId,
        title: row.documentTitle,
        href: `/docs/${row.documentId}`,
        updatedAt: row.documentUpdatedAt,
      });
    }
  }

  return [...serviceMap.values()];
}
