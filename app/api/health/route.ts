export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "studio-laser-dashboard" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
