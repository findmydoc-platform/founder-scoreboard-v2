import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { createSupabaseBacklogReadModel } from "@/features/backlog/server/backlog-read-model-supabase";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(
    request,
    (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!apiContext.ok) return apiContext.response;
  const result = await createSupabaseBacklogReadModel(apiContext.supabase).load({
    authorized: true,
    actorProfileId: apiContext.permission.profile?.id || null,
  });
  if (result.status === "forbidden") return apiError("Backlog darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Backlog konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model });
}
