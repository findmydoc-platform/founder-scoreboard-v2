import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export async function GET(request: NextRequest) {
  const apiContext = await requirePlanningContext(request, "planning.sprint.read");
  if (!apiContext.ok) return apiContext.response;
  const currentProfile = apiContext.permission.profile;
  const [result, header] = await Promise.all([
    apiContext.planning.loadSprint(), apiContext.planning.loadHeader(),
  ]);
  if (!header.ok) return authzError(header);
  if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Sprint konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, headerData: header.headerData, currentProfile });
}
