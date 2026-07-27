import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { createGroupForService, resolveServiceBearerToken } from "@/server/services";

// Den Phase 4 (docs/DEN_EMBED_BRIDGE.md §C.9, "Design settled"). Contract (§4):
// POST /api/embed/groups (service bearer) { name } -> { groupId }
//
// Owner op: authenticated as the SERVICE itself (a service_tokens bearer),
// not as a Vault user's OAuth token — see resolveServiceBearerToken
// (server/services.ts). Den calls this to lazily create one group per chat.
export const runtime = "nodejs";

const bodySchema = z.object({ name: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const service = await resolveServiceBearerToken(request);

  if (!service) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid service bearer token." },
      { status: 401 },
    );
  }

  const rateLimit = checkRateLimit(`embed-groups-create:${service.serviceId}`, 120, 60_000);

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

  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "name is required." },
      { status: 400 },
    );
  }

  const group = await createGroupForService(service.serviceId, parsed.data.name);

  return NextResponse.json(
    { groupId: group.id },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
