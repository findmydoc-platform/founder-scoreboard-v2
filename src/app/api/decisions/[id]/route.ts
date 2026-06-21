import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import { apiError, requireApiContext } from "@/lib/api-response";

type UpdateDecisionPayload = {
  title?: string;
  context?: string;
  decision?: string;
  requiredProfileIds?: string[];
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireCEO);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const decisionId = Number(id);
  const payload = (await request.json()) as UpdateDecisionPayload;

  const title = cleanText(payload.title, 160);
  const contextText = cleanText(payload.context, 4000);
  const decisionText = cleanText(payload.decision, 4000);
  const requiredProfileIds = Array.isArray(payload.requiredProfileIds) ? [...new Set(payload.requiredProfileIds)].filter(Boolean) : [];

  if (!title) return apiError("Titel ist erforderlich.", 400);
  if (!decisionText) return apiError("Entscheidungstext ist erforderlich.", 400);
  if (!requiredProfileIds.length) return apiError("Mindestens eine bestätigende Person ist erforderlich.", 400);

  const { data: before, error: readError } = await supabase
    .from("decision_log")
    .select("id,title,context,decision,status,required_profile_ids,created_by,locked_at")
    .eq("id", decisionId)
    .single();

  if (readError || !before) return apiError("Decision nicht gefunden.", 404);
  if (before.status === "locked") return apiError("Gelockte Decisions sind unveränderlich.", 409);

  const { data: updated, error: updateError } = await supabase
    .from("decision_log")
    .update({
      title,
      context: contextText,
      decision: decisionText,
      required_profile_ids: requiredProfileIds,
      status: "open_for_confirmation",
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", decisionId)
    .select("id,title,context,decision,status,required_profile_ids,created_by,locked_at")
    .single();

  if (updateError) return apiError(updateError.message, 500);

  await supabase.from("decision_confirmations").delete().eq("decision_id", decisionId);

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: "decision.update",
    actor_profile_id: permission.profile?.id || null,
    before_data: before,
    after_data: updated,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    ok: true,
    decision: {
      id: updated.id,
      title: updated.title,
      context: updated.context || "",
      decision: updated.decision || "",
      status: updated.status,
      requiredProfileIds: updated.required_profile_ids || [],
      confirmedProfileIds: [],
      createdBy: updated.created_by || "",
      lockedAt: updated.locked_at || "",
    },
  });
}
