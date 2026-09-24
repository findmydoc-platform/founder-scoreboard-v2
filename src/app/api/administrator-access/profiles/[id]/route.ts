import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireAdministratorEligibilityManager, resolveAdministratorAccessFailure } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const permission = await requireAdministratorEligibilityManager(request);
  if (!permission.ok) return authzError(permission);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);
  const payload = await request.json().catch(() => null) as { eligible?: unknown } | null;
  if (typeof payload?.eligible !== "boolean") return apiError("Eligibility muss gesetzt sein.", 400);
  const { id } = await context.params;
  const { data, error } = await supabase.rpc("set_administrator_eligibility", {
    p_profile_id: id,
    p_eligible: payload.eligible,
  });
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "42501") {
    return authzError(await resolveAdministratorAccessFailure(supabase));
  }
  if (error) return apiError("Adminberechtigung konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ administratorAccess: data });
}
