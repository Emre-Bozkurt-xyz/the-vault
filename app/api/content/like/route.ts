import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  toggleContentLike,
  type ContentTarget,
} from "@/server/content-interactions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    targetKind?: string;
    targetId?: string;
  } | null;
  const target = parseTarget(body);

  if (!target) {
    return NextResponse.json(
      { error: "Invalid content target.", code: "INVALID_TARGET" },
      { status: 400 },
    );
  }

  try {
    const result = await toggleContentLike({
      target,
      userId: session.user.id,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Public content not found.", code: "CONTENT_NOT_FOUND" },
      { status: 404 },
    );
  }
}

function parseTarget(
  body: { targetKind?: string; targetId?: string } | null,
): ContentTarget | null {
  if (!body?.targetId) {
    return null;
  }

  if (body.targetKind === "document" || body.targetKind === "asset") {
    return {
      kind: body.targetKind,
      id: body.targetId,
    };
  }

  return null;
}
