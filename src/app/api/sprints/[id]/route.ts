import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, isIsoDate } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { apiError, requireApiContext } from "@/lib/api-response";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

type UpdateSprintPayload = {
  name?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  reviewDueAt?: string;
};

const sprintStatuses = new Set(["planning", "active", "review", "closed"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireOperationalLead);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const payload = (await request.json()) as UpdateSprintPayload;

  const { data: current, error: currentError } = await supabase
    .from("sprints")
    .select("id,project_id,name,status,start_date,end_date,review_due_at,score_locked,updated_at")
    .eq("id", id)
    .single();

  if (currentError || !current) return apiError("Sprint wurde nicht gefunden.", 404);
  if (current.score_locked) return apiError("Gelockte Sprints können nicht mehr geändert werden.", 409);

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
    const { count, error: taskCountError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("sprint_id", id);

    if (taskCountError) return apiError(taskCountError.message, 500);
    if ((count || 0) > 0) {
      return NextResponse.json({
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
      },
    });
  }

  const metadata = auditRequestMetadata(request);
  const { data: updated, error: updateError } = await supabase.rpc("update_sprint_schedule_transaction", {
    p_sprint_id: id,
    p_expected_updated_at: current.updated_at,
    p_sprint_patch: update,
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (updateError) {
    if (updateError.code === "P0001") return apiError("Sprint wurde parallel geändert. Bitte neu laden.", 409);
    if (updateError.code === "P0002") return apiError("Sprint oder FounderOps-Prozesseinstellung wurde nicht gefunden.", 404);
    if (updateError.code === "P0003") return apiError("Gelockte Sprints können nicht mehr geändert werden.", 409);
    if (updateError.code === "P0004") return apiError("Dieser Sprint ist durch zugeordnete Aufgaben geschützt.", 409);
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
    },
  });
}
