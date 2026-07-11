import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireFounder } from "@/lib/authz";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder, {
    supabaseUnavailableMessage: "Supabase ist für Team-Intake-Tokens erforderlich.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const { id } = await context.params;
  if (!uuidPattern.test(id)) return apiError("Token-ID ist ungültig.", 400);

  const { data, error } = await supabase
    .from("team_task_intake_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profileId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return apiError(error.message, error.code === "42P01" ? 503 : 500);
  if (!data) return apiError("Aktiver Token wurde nicht gefunden.", 404);
  return NextResponse.json({ ok: true, tokenId: data.id });
}
