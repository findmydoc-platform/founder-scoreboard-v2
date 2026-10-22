import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

async function handleGET(request: NextRequest) {
  const apiContext = await requirePlanningContext(request, "planning.sprint.read");
  if (!apiContext.ok) return apiContext.response;
  const currentProfile = apiContext.permission.profile;
  const [result, header] = await Promise.all([
    apiContext.planning.loadSprint(), apiContext.planning.loadHeader(),
  ]);
  if (!header.ok) return authzError(header);
  if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Sprint konnte nicht geladen werden.", 503);
  return observeRuntimePreparation(() => NextResponse.json({ model: result.model, headerData: header.headerData, currentProfile }));
}

export const GET = observeRuntimeHandler("planning.sprint", handleGET);
