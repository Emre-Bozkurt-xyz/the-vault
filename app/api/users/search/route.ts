import { NextResponse } from "next/server";

import { searchUsersForCurrentUser } from "@/server/profile";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const users = await searchUsersForCurrentUser(query);

  return NextResponse.json({ users });
}
