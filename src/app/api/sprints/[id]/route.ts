import { NextResponse, type NextRequest } from "next/server";
import { isIsoDate } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type UpdateSprintPayload = {
  name?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  reviewDueAt?: string;
};

const sprintStatuses = new Set(["planning", "active", "review", "closed"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return authzError(permission);

  const { id } = await context.params;
  const payload = (await request.json()) as UpdateSprintPayload;

  const { data: current, error: currentError } = await supabase
    .from("sprints")
    .select("id,name,status,start_date,end_date,review_due_at,score_locked")
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
    update.review_due_at = payload.reviewDueAt || null;
  }

  const startDate = update.start_date ?? current.start_date;
  const endDate = update.end_date ?? current.end_date;
  if (startDate && endDate && startDate > endDate) {
    return apiError("Sprint-Start darf nicht nach dem Sprint-Ende liegen.", 400);
  }

  const timelineChanged = (update.name !== undefined && update.name !== current.name)
    || (update.start_date !== undefined && update.start_date !== current.start_date)
    || (update.end_date !== undefined && update.end_date !== current.end_date)
    || (update.review_due_at !== undefined && update.review_due_at !== current.review_due_at);

  if (timelineChanged) {
    const { count, error: taskCountError } = await supabase
      .from("tasks")
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

  update.updated_at = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("sprints")
    .update(update)
    .eq("id", id)
    .select("id,name,status,start_date,end_date,review_due_at,score_locked")
    .single();

  if (updateError || !updated) return apiError(updateError?.message || "Sprint konnte nicht gespeichert werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.update",
    entity_type: "sprint",
    entity_id: id,
    before_data: current,
    after_data: updated,
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    sprint: {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      startDate: updated.start_date || "",
      endDate: updated.end_date || "",
      reviewDueAt: updated.review_due_at || "",
      scoreLocked: updated.score_locked,
    },
  });
}
