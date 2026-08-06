import { proxyNucleusRequest } from "../../../../lib/nucleus/proxy";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return proxyNucleusRequest(request, "production-stats");
}
