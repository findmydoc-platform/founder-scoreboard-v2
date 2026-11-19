import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";

export async function GET(request: NextRequest) {
  const area = request.nextUrl.searchParams.get("area");
  if (area !== "people" && area !== "metrics") return supportingWorkspaceGet(request, "team.read");
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "team.read" });
  if (!permission.ok) return authzError(permission);
  const result = area === "metrics" ? await permission.resource.loadTeamMetrics({ signal: request.signal }) : await permission.resource.loadTeamPeople({ signal: request.signal });
  if (result.status === "staleContinuation") return NextResponse.json({ error: "Die Team-Metrikgrundlage hat sich geändert.", code: "stale_source" }, { status: 409 });
  if (result.status === "forbidden") return apiError("Team darf nicht geladen werden.", 403);
  if (result.status !== "ready") return apiError("Team konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, readAuthority: result.readAuthority, currentProfile: permission.profile }, { headers: { "cache-control": "no-store" } });
}
