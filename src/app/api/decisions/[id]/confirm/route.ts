import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { apiError, requireApiContext } from "@/lib/api-response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const { id } = await context.params;
  const decisionId = Number(id);

  const { data: decision, error: decisionError } = await supabase
    .from("decision_log")
    .select("id,status,required_profile_ids")
    .eq("id", decisionId)
    .single();

  if (decisionError || !decision) return apiError("Decision nicht gefunden.", 404);
  if (decision.status === "locked") return apiError("Decision ist bereits gelockt.", 409);
  if (decision.status !== "open_for_confirmation") {
    return apiError("Decision ist noch nicht zur Bestätigung geöffnet.", 409);
  }

  const { error } = await supabase
    .from("decision_confirmations")
    .upsert({ decision_id: decisionId, profile_id: permission.profile.id });

  if (error) return apiError(error.message, 500);

  const { data: confirmations } = await supabase
    .from("decision_confirmations")
    .select("profile_id")
    .eq("decision_id", decisionId);

  const confirmedIds = new Set((confirmations || []).map((item) => item.profile_id));
  const requiredIds = decision.required_profile_ids || [];
  const shouldLock = requiredIds.length > 0 && requiredIds.every((profileId: string) => confirmedIds.has(profileId));

  if (shouldLock) {
    await supabase
      .from("decision_log")
      .update({ status: "locked", locked_at: new Date().toISOString() })
      .eq("id", decisionId);
  }

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: shouldLock ? "confirm_and_lock" : "confirm",
    actor_profile_id: permission.profile.id,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    ok: true,
    locked: shouldLock,
    confirmedProfileIds: [...confirmedIds],
  });
}
