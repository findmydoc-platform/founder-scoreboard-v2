import type { NextRequest } from "next/server";
import { authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function POST(request: NextRequest, context: RouteContext<"/api/team/platform-releases/v1/releases/[version]/seen">) {
  const { version } = await context.params;
  const auth = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "releases.seen", version });
  if (!auth.ok) return authzError(auth, { ok: false });
  const { error } = await auth.account.markReleaseSeen();
  if (error) return Response.json({ ok: false, error: error.message }, { status: error.status });
  return Response.json({ ok: true });
}
