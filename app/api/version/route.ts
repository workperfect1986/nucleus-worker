export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.RAILWAY_DEPLOYMENT_ID
    || process.env.BUILD_VERSION
    || "development";

  return Response.json(
    { version },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
