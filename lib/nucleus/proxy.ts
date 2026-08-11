const defaultWorkerUrl = "http://localhost:8787";
const requestTimeoutMs = 10 * 60 * 1000;

export async function proxyNucleusRequest(request: Request, endpoint: "extract" | "production-stats" | "clients") {
  const workerUrl = (process.env.NUCLEUS_WORKER_INTERNAL_URL || defaultWorkerUrl).replace(/\/$/, "");

  try {
    const upstream = await fetch(`${workerUrl}/${endpoint}`, {
      method: request.method,
      headers: request.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Nucleus worker is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
