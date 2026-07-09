import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformRole } from "@/lib/authz";
import { getPlanningData } from "@/lib/planning-data";
import { apiError, authzError } from "@/lib/api-response";
import { getPlanningDataScopeForWorkspace, planningDataWorkspaceFromValue } from "@/lib/planning-data-scopes";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRole(request, ["ceo", "founder", "deputy", "viewer"]);
  if (!auth.ok) return authzError(auth);

  const rawWorkspace = request.nextUrl.searchParams.get("workspace");
  const workspace = planningDataWorkspaceFromValue(rawWorkspace);
  if (rawWorkspace && !workspace) return apiError("Unknown planning workspace.", 400);

  const result = await getPlanningData(workspace ? getPlanningDataScopeForWorkspace(workspace) : undefined);
  return NextResponse.json({ ...result, currentProfile: auth.profile });
}
