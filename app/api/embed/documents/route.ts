import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAccessToken } from "@/lib/mcp/oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUserActiveById } from "@/server/authz";
import {
  cloneDocumentIntoGroup,
  createGroupOwnedDocument,
  getServiceOwnedGroup,
  isUserInGroup,
  resolveServiceBearerToken,
} from "@/server/services";

// Header carrying the acting user's OAuth access token for the clone form.
// `Authorization` stays the service token (consistent with every other
// owner-op route), so delegation needs a second channel.
const actingUserHeader = "x-vault-acting-user-token";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.10, "Design settled"). Contract (§4):
// POST /api/embed/documents (service bearer), two forms:
//   { title, groupId }                    -> { documentId }  (create)
//   { sourceDocumentId, groupId, title? }  -> { documentId }  (clone)
//
// Den's usage model is create-or-clone, never adopting a user's existing
// document in place. Both forms create a document owned by the group; the
// document's structural `ownerId` is always the service's principal (see the
// schema comment on `documents.owningGroupId`).
export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  groupId: z.string().uuid(),
});

const cloneSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  groupId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const service = await resolveServiceBearerToken(request);

  if (!service) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid service bearer token." },
      { status: 401 },
    );
  }

  const rateLimit = checkRateLimit(`embed-documents-create:${service.serviceId}`, 120, 60_000);

  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rateLimit.retryAfterMs / 1000).toString() },
      },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const isCloneRequest =
    typeof payload === "object" &&
    payload !== null &&
    "sourceDocumentId" in payload;

  if (isCloneRequest) {
    const parsed = cloneSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    // Clone is user-delegated: the service token authorizes writing into the
    // group, the acting user's OAuth token authorizes *reading the source*.
    // Both are required. Checking the source against the principal instead
    // (the original implementation) made a user's own private document
    // unclonable, defeating the create-or-clone model.
    const actingUserToken = request.headers.get(actingUserHeader)?.trim();

    if (!actingUserToken) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: `Cloning requires the acting user's OAuth access token in the ${actingUserHeader} header.`,
        },
        { status: 400 },
      );
    }

    const actingUser = await resolveAccessToken(actingUserToken);

    if (!actingUser) {
      return NextResponse.json(
        { error: "invalid_token", error_description: "Invalid or expired acting-user token." },
        { status: 401 },
      );
    }

    const group = await getServiceOwnedGroup(service.serviceId, parsed.data.groupId);

    if (!group) {
      return notFound();
    }

    // The acting user must belong to the destination group, and must not be
    // banned. Membership is the load-bearing check: the service can already
    // read this user's documents with their consented token, but cloning
    // re-exposes the content to *other* people, so the destination has to be
    // a group the user is actually part of.
    const [isActive, isMember] = await Promise.all([
      isUserActiveById(actingUser.userId),
      isUserInGroup(actingUser.userId, group.id),
    ]);

    if (!isActive || !isMember) {
      return notFound();
    }

    const cloned = await cloneDocumentIntoGroup({
      principalUserId: service.principalUserId,
      actingUserId: actingUser.userId,
      groupId: group.id,
      sourceDocumentId: parsed.data.sourceDocumentId,
      title: parsed.data.title,
    });

    // Source doesn't exist, or the acting user can't read it — never
    // distinguish which on the wire (AGENTS.md §4 / docs/04 §10).
    if (!cloned) {
      return notFound();
    }

    return NextResponse.json(
      { documentId: cloned.id },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = createSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const group = await getServiceOwnedGroup(service.serviceId, parsed.data.groupId);

  if (!group) {
    return notFound();
  }

  const created = await createGroupOwnedDocument({
    principalUserId: service.principalUserId,
    groupId: group.id,
    title: parsed.data.title,
  });

  return NextResponse.json(
    { documentId: created.id },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
