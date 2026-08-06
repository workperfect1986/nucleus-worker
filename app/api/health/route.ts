export const dynamic = "force-dynamic";

export async function GET() {
  const workerUrl = (process.env.NUCLEUS_WORKER_INTERNAL_URL || "http://localhost:8787").replace(/\/$/, "");

  try {
    const workerResponse = await fetch(`${workerUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!workerResponse.ok) throw new Error(`Worker health returned ${workerResponse.status}`);

    return Response.json(
      { status: "ok", service: "studio-laser-dashboard", worker: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "studio-laser-dashboard", worker: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
