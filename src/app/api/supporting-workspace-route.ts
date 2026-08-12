import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import type { getServerSupabase } from "@/lib/supabase";

type ServerSupabase = NonNullable<ReturnType<typeof getServerSupabase>>;
type SupportingReadModel<M> = {
  load(context: { authorized: boolean; actorProfileId: string | null }): Promise<
    { status: "ready"; model: M } | { status: "forbidden" } | { status: "unavailable" }
  >;
};

export async function supportingWorkspaceGet<M>(
  request: NextRequest,
  createReadModel: (supabase: ServerSupabase) => SupportingReadModel<M>,
  label: string,
) {
  const apiContext = await requireApiContext(
    request,
    (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!apiContext.ok) return apiContext.response;
  const currentProfile = apiContext.permission.profile;
  const [result, headerData] = await Promise.all([
    createReadModel(apiContext.supabase).load({ authorized: true, actorProfileId: currentProfile?.id || null }),
    loadPlanningHeaderData(apiContext.supabase, {
      currentProfileId: currentProfile?.id || null,
      platformRole: currentProfile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  if (result.status === "forbidden") return apiError(`${label} darf nicht geladen werden.`, 403);
  if (result.status === "unavailable") return apiError(`${label} konnte nicht geladen werden.`, 503);
  return NextResponse.json({ model: result.model, headerData, currentProfile });
}
