import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type ObjectionPayload = {
  comment?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ObjectionPayload>(request, requireFounder, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const { id } = await context.params;
  const decisionId = Number(id);
  const comment = cleanText(payload.comment, 2000);

  if (!comment) return apiError("Ein Kommentar ist erforderlich.", 400);

  const { data: decision, error: decisionError } = await supabase
    .from("decision_log")
    .select("id,status")
    .eq("id", decisionId)
    .single();

  if (decisionError || !decision) return apiError("Decision nicht gefunden.", 404);
  if (decision.status === "locked") return apiError("Gelockte Decisions können nicht mehr beanstandet werden.", 409);

  const { data: objection, error } = await supabase
    .from("decision_comments")
    .insert({
      decision_id: decisionId,
      profile_id: permission.profile.id,
      type: "objection",
      comment,
    })
    .select("id,decision_id,profile_id,type,comment,created_at")
    .single();

  if (error) return apiError(error.message, 500);

  await supabase.from("audit_log").insert({
    entity_type: "decision",
    entity_id: String(decisionId),
    action: "decision.objection",
    actor_profile_id: permission.profile.id,
    after_data: objection,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent") || null,
  });

  return NextResponse.json({
    ok: true,
    comment: {
      id: objection.id,
      decisionId: objection.decision_id,
      profileId: objection.profile_id || "",
      type: objection.type,
      comment: objection.comment,
      createdAt: objection.created_at,
    },
  });
}
