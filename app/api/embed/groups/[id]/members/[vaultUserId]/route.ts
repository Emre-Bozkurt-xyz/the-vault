import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  getServiceOwnedGroup,
  removeGroupMember,
  resolveServiceBearerToken,
} from "@/server/services";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.9, "Design settled"). Contract (§4):
// DELETE /api/embed/groups/:id/members/:vaultUserId (service bearer) ->
// remove, idempotent. Backs "leaves chat" / "unlinks account", plus Den's
// reconciliation sweep.
export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
  vaultUserId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ id: string; vaultUserId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const service = await resolveServiceBearerToken(request);

  if (!service) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid service bearer token." },
      { status: 401 },
    );
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

  const { id, vaultUserId } = await context.params;
  const parsed = paramsSchema.safeParse({ id, vaultUserId });

  if (!parsed.success) {
    return notFound();
  }

  const group = await getServiceOwnedGroup(service.serviceId, parsed.data.id);

  if (!group) {
    return notFound();
  }

  await removeGroupMember(group.id, parsed.data.vaultUserId);

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
