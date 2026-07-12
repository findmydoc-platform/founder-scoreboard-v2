import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type ObjectionPayload = {
  comment?: string;
};

type ReviewPayload = {
  action?: "resolve" | "second_review";
  objectionId?: number;
  status?: "reviewed" | "dismissed" | "accepted";
  resolutionComment?: string;
  deliveryPoints?: number;
  formPoints?: number;
  weeklyPoints?: number;
  secondReviewDecision?: string;
};

const objectionSelect = "id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,resolved_delivery_points,resolved_form_points,resolved_weekly_points,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ObjectionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const { id } = await context.params;
  const comment = cleanText(payload.comment, 2000);
  if (!comment) return apiError("Einwand ist erforderlich.", 400);

  const { data: sprint, error: sprintError } = await supabase
    .from("sprints")
    .select("id,score_locked,review_due_at")
    .eq("id", id)
    .single();
  if (sprintError || !sprint) return apiError("Sprint wurde nicht gefunden.", 404);
  if (sprint.score_locked) return apiError("Gelockte Sprints können nicht mehr beanstandet werden.", 409);
  if (sprint.review_due_at && new Date(sprint.review_due_at).getTime() < Date.now()) {
    return apiError("Die 48-Stunden-Einspruchsfrist ist abgelaufen.", 409);
  }

  const { data: score } = await supabase
    .from("founder_sprint_scores")
    .select("id")
    .eq("sprint_id", id)
    .eq("profile_id", permission.profile.id)
    .maybeSingle();

  const { data: objection, error } = await supabase
    .from("score_objections")
    .insert({
      sprint_id: id,
      profile_id: permission.profile.id,
      founder_sprint_score_id: score?.id || null,
      status: "open",
      comment,
    })
    .select(objectionSelect)
    .single();

  if (error || !objection) return apiError(error?.message || "Score-Einwand konnte nicht gespeichert werden.", 500);

  await supabase.from("audit_log").insert({
    entity_type: "score_objection",
    entity_id: String(objection.id),
    action: "score_objection.create",
    actor_profile_id: permission.profile.id,
    after_data: objection,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, objection });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ReviewPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile || !["ceo", "deputy"].includes(permission.profile.platformRole)) {
    return apiError("Nur CEO oder Deputy können Score-Einwände prüfen.", 403);
  }

  const { id } = await context.params;
  const objectionId = Number(payload.objectionId);
  const action = payload.action || "resolve";
  const status = payload.status;
  if (!Number.isFinite(objectionId)) return apiError("Einwand ist erforderlich.", 400);
  if (!["resolve", "second_review"].includes(action)) return apiError("Ungültige Einwand-Aktion.", 400);
  if (action === "resolve" && (!status || !["reviewed", "dismissed", "accepted"].includes(status))) {
    return apiError("Ungültiger Einwand-Status.", 400);
  }

  const resolutionComment = cleanText(payload.resolutionComment, 2000);
  const secondReviewDecision = cleanText(payload.secondReviewDecision, 2000);
  if (action === "resolve" && !resolutionComment) return apiError("Eine Begründung zur Entscheidung ist erforderlich.", 400);
  if (action === "second_review" && !secondReviewDecision) return apiError("Eine Zweitreview-Entscheidung ist erforderlich.", 400);

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error } = await supabase.rpc("resolve_score_objection_transaction", {
    p_sprint_id: id,
    p_objection_id: objectionId,
    p_actor_profile_id: permission.profile.id,
    p_action: action,
    p_status: status || null,
    p_resolution_comment: resolutionComment || null,
    p_delivery_points: payload.deliveryPoints ?? null,
    p_form_points: payload.formPoints ?? null,
    p_weekly_points: payload.weeklyPoints ?? null,
    p_second_review_decision: secondReviewDecision || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (error) {
    if (error.code === "P0002") return apiError("Sprint oder Score-Einwand wurde nicht gefunden.", 404);
    if (error.code === "P0003") return apiError("Sprint-Score ist bereits gelockt.", 409);
    if (error.code === "P0004") return apiError("Score-Einwand wurde bereits bearbeitet oder ist noch offen.", 409);
    if (error.code === "P0005") return apiError("Der Zweitreview muss durch eine andere Person erfolgen.", 409);
    if (error.code === "P0006") return apiError("Der Zweitreview wurde bereits abgeschlossen.", 409);
    if (error.code === "22023") return apiError("Einwand-Entscheidung ist unvollständig oder ungültig.", 400);
    return apiError(error.message || "Score-Einwand konnte nicht geprüft werden.", 500);
  }

  const result = transactionData as { objection?: unknown; score?: unknown } | null;
  if (!result?.objection) return apiError("Score-Einwand konnte nicht geprüft werden.", 500);
  return NextResponse.json({ ok: true, objection: result.objection, score: result.score || null });
}
