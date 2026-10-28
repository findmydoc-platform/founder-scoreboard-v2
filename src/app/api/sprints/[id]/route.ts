import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, isIsoDate } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

type UpdateSprintPayload = {
  expectedUpdatedAt?: string;
  name?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  reviewDueAt?: string;
};

const sprintStatuses = new Set(["planning", "active", "review", "closed"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.sprint.update", id);
  if (!apiContext.ok) return apiContext.response;

  const { planning } = apiContext;
  const payload = (await request.json()) as UpdateSprintPayload;

  const { data: current, error: currentError } = await planning.readSprintSchedule();

  if (currentError || !current) return apiError("Sprint wurde nicht gefunden.", 404);
  if (current.score_locked) return NextResponse.json({ error: "Gelockte Sprints können nicht mehr geändert werden.", code: "sprint_locked" }, { status: 409 });
  if (typeof payload.expectedUpdatedAt !== "string" || !payload.expectedUpdatedAt.trim()) return apiError("Die ursprüngliche Bearbeitungsbasis fehlt. Bitte den Sprint neu laden.", 400);

  const update: Record<string, string | null> = {};

  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (!name) return apiError("Sprint-Name ist erforderlich.", 400);
    update.name = name;
  }

  if (payload.status !== undefined) {
    if (!sprintStatuses.has(payload.status)) return apiError("Ungültiger Sprint-Status.", 400);
    update.status = payload.status;
  }

  if (payload.startDate !== undefined) {
    if (payload.startDate && !isIsoDate(payload.startDate)) return apiError("Ungültiges Startdatum.", 400);
    update.start_date = payload.startDate || null;
  }

  if (payload.endDate !== undefined) {
    if (payload.endDate && !isIsoDate(payload.endDate)) return apiError("Ungültiges Enddatum.", 400);
    update.end_date = payload.endDate || null;
  }

  if (payload.reviewDueAt !== undefined) {
    return apiError("Die Review-Frist wird automatisch aus dem Sprint-Ende abgeleitet.", 400);
  }

  const startDate = update.start_date ?? current.start_date;
  const endDate = update.end_date ?? current.end_date;
  if (startDate && endDate && startDate > endDate) {
    return apiError("Sprint-Start darf nicht nach dem Sprint-Ende liegen.", 400);
  }

  const timelineChanged = (update.name !== undefined && update.name !== current.name)
    || (update.start_date !== undefined && update.start_date !== current.start_date)
    || (update.end_date !== undefined && update.end_date !== current.end_date);

  if (timelineChanged) {
    const { count, error: taskCountError } = await planning.readSprintTaskCount();

    if (taskCountError) return apiError(taskCountError.message, 500);
    if ((count || 0) > 0) {
      return NextResponse.json({
        code: "sprint_protected",
        error: `Dieser Sprint ist geschützt, weil ${count} Aufgabe${count === 1 ? "" : "n"} damit verknüpft ${count === 1 ? "ist" : "sind"}. Zeitraum, Name und Review-Datum dürfen nur bei leeren Sprints geändert werden.`,
      }, { status: 409 });
    }
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({
      ok: true,
      sprint: {
        id: current.id,
        name: current.name,
        status: current.status,
        startDate: current.start_date || "",
        endDate: current.end_date || "",
        reviewDueAt: current.review_due_at || "",
        scoreLocked: current.score_locked,
        updatedAt: current.updated_at,
      },
    });
  }

  const metadata = auditRequestMetadata(request);
  const { data: updated, error: updateError } = await planning.commitSprintSchedule({ expectedUpdatedAt: payload.expectedUpdatedAt, patch: update }, metadata);
  if (updateError) {
    if (updateError.code === "P0001") return NextResponse.json({ error: "Sprint wurde parallel geändert. Bitte neu laden.", code: "sprint_revision_conflict" }, { status: 409 });
    if (updateError.code === "P0002") return apiError("Sprint oder FounderOps-Prozesseinstellung wurde nicht gefunden.", 404);
    if (updateError.code === "P0003") return NextResponse.json({ error: "Gelockte Sprints können nicht mehr geändert werden.", code: "sprint_locked" }, { status: 409 });
    if (updateError.code === "P0004") return NextResponse.json({ error: "Dieser Sprint ist durch zugeordnete Aufgaben geschützt.", code: "sprint_protected" }, { status: 409 });
    if (updateError.code === "22023") return apiError("Sprint-Daten sind ungültig.", 400);
    return apiError("Sprint konnte nicht gespeichert werden.", 500);
  }
  if (!updated) return apiError("Sprint konnte nicht vollständig gespeichert werden.", 500);

  const updatedSprint = updated as {
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    review_due_at: string | null;
    score_locked: boolean;
    updated_at: string;
  };

  return NextResponse.json({
    ok: true,
    sprint: {
      id: updatedSprint.id,
      name: updatedSprint.name,
      status: updatedSprint.status,
      startDate: updatedSprint.start_date || "",
      endDate: updatedSprint.end_date || "",
      reviewDueAt: updatedSprint.review_due_at || "",
      scoreLocked: updatedSprint.score_locked,
      updatedAt: updatedSprint.updated_at,
    },
  });
}
