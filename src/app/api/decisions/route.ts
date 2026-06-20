import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireCEO } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type CreateDecisionPayload = {
  title?: string;
  context?: string;
  decision?: string;
  requiredProfileIds?: string[];
};

export async function POST(request: NextRequest) {
  const apiContext = await requireJsonApiContext<CreateDecisionPayload>(request, requireCEO, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const title = cleanText(payload.title, 160);
  const context = cleanText(payload.context, 4000);
  const decision = cleanText(payload.decision, 4000);
  const requiredProfileIds = Array.isArray(payload.requiredProfileIds) ? [...new Set(payload.requiredProfileIds)].filter(Boolean) : [];

  if (!title) return apiError("Titel ist erforderlich.", 400);
  if (!decision) return apiError("Entscheidungstext ist erforderlich.", 400);
  if (!requiredProfileIds.length) return apiError("Mindestens eine bestätigende Person ist erforderlich.", 400);

  const { data, error } = await supabase
    .from("decision_log")
    .insert({
      title,
      context,
      decision,
      status: "open_for_confirmation",
      required_profile_ids: requiredProfileIds,
      created_by: permission.profile?.id || null,
    })
    .select("*, decision_confirmations(profile_id)")
    .single();

  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(data.id),
    action: "create",
    actor_profile_id: permission.profile?.id || null,
    after_data: data,
    request_ip: request.headers.get("x-forwarded-for") || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    decision: {
      id: data.id,
      title: data.title,
      context: data.context || "",
      decision: data.decision || "",
      status: data.status,
      requiredProfileIds: data.required_profile_ids || [],
      confirmedProfileIds: [],
      createdBy: data.created_by || "",
      lockedAt: data.locked_at || "",
    },
  });
}
