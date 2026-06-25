import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  recordContentView,
  type ContentTarget,
} from "@/server/content-interactions";
import { getAnonymousHashFromHeaders } from "@/server/content-viewer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
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
    const stats = await recordContentView({
      target,
      viewer: {
        userId: session?.user?.id ?? null,
        anonymousHash: session?.user?.id
          ? null
          : getAnonymousHashFromHeaders(request.headers),
      },
    });

    return NextResponse.json({ stats });
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
