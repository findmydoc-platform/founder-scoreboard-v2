import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type ObjectionPayload = {
  comment?: string;
};

type ReviewPayload = {
  objectionId?: number;
  status?: "reviewed" | "dismissed" | "accepted";
  resolutionComment?: string;
  secondReviewerProfileId?: string;
  secondReviewDecision?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ObjectionPayload>(request, requireFounder, {});
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
    .select("id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at")
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
  const apiContext = await requireJsonApiContext<ReviewPayload>(request, requireFounder, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile || !["ceo", "deputy"].includes(permission.profile.platformRole)) {
    return apiError("Nur CEO oder Deputy können Score-Einwände prüfen.", 403);
  }

  const { id } = await context.params;
  const objectionId = Number(payload.objectionId);
  const status = payload.status || "reviewed";
  if (!Number.isFinite(objectionId)) return apiError("Einwand ist erforderlich.", 400);
  if (!["reviewed", "dismissed", "accepted"].includes(status)) return apiError("Ungültiger Einwand-Status.", 400);

  const resolutionComment = cleanText(payload.resolutionComment, 2000);
  const secondReviewerProfileId = cleanText(payload.secondReviewerProfileId, 100);
  const secondReviewDecision = cleanText(payload.secondReviewDecision, 2000);
  const now = new Date().toISOString();

  const { data: objection, error } = await supabase
    .from("score_objections")
    .update({
      status,
      resolution_comment: resolutionComment,
      reviewed_by: permission.profile.id,
      reviewed_at: now,
      second_reviewer_profile_id: secondReviewerProfileId || null,
      second_review_decision: secondReviewDecision || null,
      second_reviewed_at: secondReviewerProfileId || secondReviewDecision ? now : null,
    })
    .eq("id", objectionId)
    .eq("sprint_id", id)
    .select("id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at")
    .single();

  if (error || !objection) return apiError(error?.message || "Score-Einwand konnte nicht geprüft werden.", 500);

  await supabase.from("audit_log").insert({
    entity_type: "score_objection",
    entity_id: String(objection.id),
    action: "score_objection.review",
    actor_profile_id: permission.profile.id,
    after_data: objection,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, objection });
}
