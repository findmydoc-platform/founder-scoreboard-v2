import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { MAX_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";

type SprintReviewWindowPayload = {
  expectedReviewObjectionWindowHours?: number;
  reviewObjectionWindowHours?: number;
};

type SprintReviewWindowTransactionResult = {
  project?: { id?: string; reviewObjectionWindowHours?: number };
  sprints?: Array<{ id?: string; reviewDueAt?: string }>;
};

const projectId = "findmydoc-founder-execution";

function validWindowHours(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_REVIEW_OBJECTION_WINDOW_HOURS;
}

export async function PATCH(request: NextRequest) {
  const context = await requirePlanningJsonContext<SprintReviewWindowPayload>(request, "planning.sprint.review-window", {});
  if (!context.ok) return context.response;

  const { payload, permission, planning } = context;
  if (!permission.profile) return apiError("CEO-Profil erforderlich.", 401);
  if (!validWindowHours(payload.expectedReviewObjectionWindowHours) || !validWindowHours(payload.reviewObjectionWindowHours)) {
    return apiError(`Die Review- und Einspruchsfrist muss zwischen 1 und ${MAX_REVIEW_OBJECTION_WINDOW_HOURS} Stunden liegen.`, 400);
  }

  const metadata = auditRequestMetadata(request);
  const { data, error } = await planning.setReviewWindow({ expectedHours: payload.expectedReviewObjectionWindowHours, hours: payload.reviewObjectionWindowHours }, metadata);

  if (error) {
    if (error.code === "P0001") return NextResponse.json({ error: "Die Prozesseinstellungen wurden parallel geändert. Bitte neu laden.", code: "review_window_conflict" }, { status: 409 });
    if (error.code === "P0002") return apiError("FounderOps-Projekt wurde nicht gefunden.", 404);
    if (error.code === "P0005") return apiError("Nur der CEO kann diese Prozesseinstellung ändern.", 403);
    if (error.code === "22023") return apiError("Die Review- und Einspruchsfrist ist ungültig.", 400);
    return apiError("Die Prozesseinstellung konnte nicht gespeichert werden.", 500);
  }

  const result = data as SprintReviewWindowTransactionResult | null;
  const savedHours = result?.project?.reviewObjectionWindowHours;
  if (!validWindowHours(savedHours)) return apiError("Die Prozesseinstellung wurde unvollständig gespeichert.", 500);

  return NextResponse.json({
    ok: true,
    project: { id: result?.project?.id || projectId, reviewObjectionWindowHours: savedHours },
    sprints: (result?.sprints || []).flatMap((sprint) => (
      sprint.id && sprint.reviewDueAt ? [{ id: sprint.id, reviewDueAt: sprint.reviewDueAt }] : []
    )),
  });
}
