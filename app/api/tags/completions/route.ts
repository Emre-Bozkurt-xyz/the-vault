import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  listTagSuggestions,
  type TagSuggestionScope,
} from "@/server/content-metadata";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const requestedScope = url.searchParams.get("scope") ?? "mine";
  const scope: TagSuggestionScope =
    requestedScope === "public" ? "public" : "mine";

  if (scope === "mine" && !session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const tags = await listTagSuggestions({
    userId: session?.user?.id,
    query,
    scope,
  });

  return NextResponse.json({ tags });
}
