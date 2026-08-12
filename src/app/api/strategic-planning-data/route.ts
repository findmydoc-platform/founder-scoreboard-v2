import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseStrategicPlanningReadModel } from "@/features/projects/server/strategic-planning-read-model-supabase";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(
    request,
    (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!apiContext.ok) return apiContext.response;
  const currentProfile = apiContext.permission.profile;
  const [result, headerData] = await Promise.all([
    createSupabaseStrategicPlanningReadModel(apiContext.supabase).load({
      authorized: true,
      actorProfileId: currentProfile?.id || null,
    }),
    loadPlanningHeaderData(apiContext.supabase, {
      currentProfileId: currentProfile?.id || null,
      platformRole: currentProfile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  if (result.status === "forbidden") return apiError("Strategische Planung darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Strategische Planung konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, headerData, currentProfile });
}
