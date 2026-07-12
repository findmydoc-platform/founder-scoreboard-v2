import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { isUuid } from "@/features/intake/model/team-task-intake-contract";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Supabase ist für Team-Intake-Tokens erforderlich.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const { id } = await context.params;
  if (!isUuid(id)) return apiError("Token-ID ist ungültig.", 400);

  const { data, error } = await supabase.rpc("revoke_team_task_intake_token", {
    p_token_id: id,
    p_profile_id: profileId,
  });

  if (error) return apiError(error.code === "PGRST202" || error.code === "42883" ? "Team-Intake-Schema ist noch nicht verfügbar." : "Team-Intake-Token konnte nicht widerrufen werden.", error.code === "PGRST202" || error.code === "42883" ? 503 : 500);
  if (!data) return apiError("Aktiver Token wurde nicht gefunden.", 404);
  return NextResponse.json({ ok: true, tokenId: data });
}
