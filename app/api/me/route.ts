import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { resolveBearerToken } from "@/lib/embed-auth";

// Den Phase 2 (docs/DEN_EMBED_BRIDGE.md §A.1): the only thing a client needs
// post-authorize to record `vault_user_id`. Bearer-authenticated the same way
// as `/api/mcp` — an OAuth access token issued by our own authorization
// server, never the Vault session cookie.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const resolved = await resolveBearerToken(request);

  if (!resolved) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid bearer token." },
      { status: 401 },
    );
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, resolved.userId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Token subject no longer exists." },
      { status: 401 },
    );
  }

  return NextResponse.json(
    { userId: user.id, name: user.name, image: user.image },
    { headers: { "Cache-Control": "no-store" } },
  );
}
