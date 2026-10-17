import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";

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
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<ObjectionPayload>(request, "planning.sprint.objection.create", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, planning } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

  const comment = cleanText(payload.comment, 2000);
  if (!comment) return apiError("Einwand ist erforderlich.", 400);

  const metadata = auditRequestMetadata(request);
  const { data: objection, error } = await planning.createScoreObjection(comment, metadata);
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
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<ReviewPayload>(request, "planning.sprint.objection.process", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, planning } = apiContext;
  if (!permission.profile) return apiError("Profil erforderlich.", 401);

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
  const { data: transactionData, error } = await planning.processScoreObjection({ objectionId, action, status: status || null,
    resolutionComment, deliveryPoints: payload.deliveryPoints, formPoints: payload.formPoints, weeklyPoints: payload.weeklyPoints,
    secondReviewerProfileId, secondReviewDecision,
  }, metadata);

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
