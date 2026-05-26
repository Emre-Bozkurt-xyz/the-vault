export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    service: "vault-web",
    ts: new Date().toISOString(),
  });
}