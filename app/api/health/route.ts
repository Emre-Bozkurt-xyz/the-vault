import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

export const runtime = "nodejs";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await db.execute(sql`select 1`);

    return NextResponse.json({
      ok: true,
      service: "vault",
      database: "ok",
      timestamp,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "vault",
        database: "unreachable",
        timestamp,
      },
      { status: 503 },
    );
  }
}
