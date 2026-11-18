import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";
import { supportingWorkspaceGet } from "@/app/api/supporting-workspace-route";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("area") !== "people") return supportingWorkspaceGet(request, "team.read");
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "team.read" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.resource.loadTeamPeople({ signal: request.signal });
  if (result.status === "forbidden") return apiError("Team darf nicht geladen werden.", 403);
  if (result.status !== "ready") return apiError("Team konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, readAuthority: result.readAuthority, currentProfile: permission.profile }, { headers: { "cache-control": "no-store" } });
}
