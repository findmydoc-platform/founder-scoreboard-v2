import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseSprintReadModel } from "@/features/sprint/server/sprint-read-model-supabase";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]));
  if (!apiContext.ok) return apiContext.response;
  const currentProfile = apiContext.permission.profile;
  const [result, headerData] = await Promise.all([
    createSupabaseSprintReadModel(apiContext.supabase).load({ authorized: true, actorProfileId: currentProfile?.id || null }),
    loadPlanningHeaderData(apiContext.supabase, {
      currentProfileId: currentProfile?.id || null,
      platformRole: currentProfile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  if (result.status === "forbidden") return apiError("Sprint darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Sprint konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model, headerData, currentProfile });
}
