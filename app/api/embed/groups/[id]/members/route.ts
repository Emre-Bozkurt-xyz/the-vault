import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  addGroupMember,
  getServiceOwnedGroup,
  resolveServiceBearerToken,
} from "@/server/services";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.9, "Design settled"). Contract (§4):
// POST /api/embed/groups/:id/members (service bearer) { vaultUserId } -> add,
// idempotent. Backs "a new user joins a Den chat" / "an existing chat member
// links their account", plus Den's reconciliation sweep (hence idempotency).
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ vaultUserId: z.string().uuid() });

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const service = await resolveServiceBearerToken(request);

  if (!service) {
    return unauthorized();
  }

  const rateLimit = checkRateLimit(`embed-group-members:${service.serviceId}`, 240, 60_000);

  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rateLimit.retryAfterMs / 1000).toString() },
      },
    );
  }

  const { id } = await context.params;
  const parsedId = paramsSchema.safeParse({ id });

  if (!parsedId.success) {
    return notFound();
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(payload);

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "vaultUserId must be a UUID." },
      { status: 400 },
    );
  }

  // A group that doesn't exist and a group owned by a different service are
  // indistinguishable on the wire: never let one service enumerate or
  // mutate another's groups.
  const group = await getServiceOwnedGroup(service.serviceId, parsedId.data.id);

  if (!group) {
    return notFound();
  }

  const added = await addGroupMember(group.id, parsedBody.data.vaultUserId);

  if (!added) {
    // vaultUserId doesn't correspond to a real Vault user.
    return notFound();
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function unauthorized() {
  return NextResponse.json(
    { error: "invalid_token", error_description: "Missing or invalid service bearer token." },
    { status: 401 },
  );
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
