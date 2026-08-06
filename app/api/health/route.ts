export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { status: "ok", service: "dayone-web", checkedAt: new Date().toISOString() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
