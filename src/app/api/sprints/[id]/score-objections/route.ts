import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type ObjectionPayload = {
  comment?: string;
};

type ReviewPayload = {
  action?: "assign_second_review" | "resolve" | "second_review";
  objectionId?: number;
  status?: "reviewed" | "dismissed" | "accepted";
  resolutionComment?: string;
  deliveryPoints?: number;
  formPoints?: number;
  weeklyPoints?: number;
  secondReviewerProfileId?: string;
  secondReviewDecision?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ObjectionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const { id } = await context.params;
  const comment = cleanText(payload.comment, 2000);
  if (!comment) return apiError("Einwand ist erforderlich.", 400);

  const metadata = auditRequestMetadata(request);
  const { data: objection, error } = await supabase.rpc("create_score_objection_transaction", {
    p_sprint_id: id,
    p_profile_id: permission.profile.id,
    p_comment: comment,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (error?.code === "P0002") return apiError("Sprint oder FounderOps-Prozesseinstellung wurde nicht gefunden.", 404);
  if (error?.code === "P0003") return apiError("Gelockte Sprints können nicht mehr beanstandet werden.", 409);
  if (error?.code === "P0004") return apiError("Score-Einwände können erst nach dem Sprint-Ende eingereicht werden.", 409);
  if (error?.code === "P0005") return apiError("Profil ist nicht zur Einreichung eines Score-Einwands berechtigt.", 403);
  if (error?.code === "P0006") return apiError("Die konfigurierte Einspruchsfrist ist abgelaufen.", 409);
  if (error?.code === "23505") return apiError("Für diesen Sprint besteht bereits ein Score-Einwand.", 409);
  if (error || !objection) return apiError(error?.message || "Score-Einwand konnte nicht gespeichert werden.", 500);

  return NextResponse.json({ ok: true, objection });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ReviewPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const { id } = await context.params;
  const objectionId = Number(payload.objectionId);
  const action = payload.action || "resolve";
  const status = payload.status;
  if (!Number.isFinite(objectionId)) return apiError("Einwand ist erforderlich.", 400);
  if (!["assign_second_review", "resolve", "second_review"].includes(action)) return apiError("Ungültige Einwand-Aktion.", 400);
  if ((action === "assign_second_review" || action === "resolve") && permission.profile.platformRole !== "ceo") {
    return apiError("Nur der CEO kann Zweitreviews zuweisen oder Score-Einwände abschließen.", 403);
  }
  if (action === "resolve" && (!status || !["reviewed", "dismissed", "accepted"].includes(status))) {
    return apiError("Ungültiger Einwand-Status.", 400);
  }

  const resolutionComment = cleanText(payload.resolutionComment, 2000);
  const secondReviewerProfileId = cleanText(payload.secondReviewerProfileId, 240);
  const secondReviewDecision = cleanText(payload.secondReviewDecision, 2000);
  if (action === "assign_second_review" && !secondReviewerProfileId) return apiError("Eine Person für den Zweitreview ist erforderlich.", 400);
  if (action === "resolve" && !resolutionComment) return apiError("Eine Begründung zur Entscheidung ist erforderlich.", 400);
  if (action === "second_review" && !secondReviewDecision) return apiError("Eine Zweitreview-Entscheidung ist erforderlich.", 400);

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error } = await supabase.rpc("process_score_objection_transaction", {
    p_sprint_id: id,
    p_objection_id: objectionId,
    p_actor_profile_id: permission.profile.id,
    p_action: action,
    p_status: status || null,
    p_resolution_comment: resolutionComment || null,
    p_delivery_points: payload.deliveryPoints ?? null,
    p_form_points: payload.formPoints ?? null,
    p_weekly_points: payload.weeklyPoints ?? null,
    p_second_reviewer_profile_id: secondReviewerProfileId || null,
    p_second_review_decision: secondReviewDecision || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (error) {
    if (error.code === "P0002") return apiError("Sprint oder Score-Einwand wurde nicht gefunden.", 404);
    if (error.code === "P0003") return apiError("Sprint-Score ist bereits gelockt.", 409);
    if (error.code === "P0004") return apiError("Score-Einwand ist bereits abgeschlossen oder der Zweitreview steht noch aus.", 409);
    if (error.code === "P0005") return apiError("Der Zweitreview muss unabhängig und durch die zugewiesene Person erfolgen.", 409);
    if (error.code === "P0006") return apiError("Der Zweitreview wurde bereits abgeschlossen.", 409);
    if (error.code === "22023") return apiError("Einwand-Entscheidung ist unvollständig oder ungültig.", 400);
    return apiError(error.message || "Score-Einwand konnte nicht geprüft werden.", 500);
  }

  const result = transactionData as { objection?: unknown; score?: unknown } | null;
  if (!result?.objection) return apiError("Score-Einwand konnte nicht geprüft werden.", 500);
  return NextResponse.json({ ok: true, objection: result.objection, score: result.score || null });
}
