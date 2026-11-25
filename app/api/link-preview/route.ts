import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLinkPreview } from "@/server/link-preview";

export const runtime = "nodejs";

/**
 * `GET /api/link-preview?url=…`: a web link's hover card data (title,
 * description, image, site) for a signed-in user. The server does the fetching
 * (`getLinkPreview`), so readers' browsers never contact the site until they
 * follow the link, and only public addresses are fetched.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`link-preview:${userId}`, 60, 60_000).ok) {
    return NextResponse.json({ message: "Too many previews; try again in a minute." }, { status: 429 });
  }
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return NextResponse.json({ message: "Previews are for web links." }, { status: 400 });
  }
  const preview = await getLinkPreview(url);
  return NextResponse.json(
    { preview },
    { headers: { "cache-control": "private, max-age=3600" } },
  );
}
