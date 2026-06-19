import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { getServerSupabase } from "@/lib/supabase";
import type { TaskFocusItem } from "@/lib/types";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type FocusPayload = {
  taskId?: string;
  profileId?: string;
  focusDate?: string;
  position?: number;
  nextStep?: string;
  status?: TaskFocusItem["status"];
};

const focusStatuses = new Set(["planned", "done", "blocked", "deferred", "needs_decision"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mapFocusItem(row: Record<string, string | number>): TaskFocusItem {
  return {
    id: Number(row.id),
    profileId: String(row.profile_id || ""),
    taskId: String(row.task_id || ""),
    focusDate: String(row.focus_date || ""),
    position: Number(row.position || 1),
    nextStep: String(row.next_step || ""),
    status: String(row.status || "planned") as TaskFocusItem["status"],
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireFounder(request);
  if (!permission.ok) return authzError(permission);

  const payload = (await request.json()) as FocusPayload;
  const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
  if (!taskId) return apiError("Aufgabe ist erforderlich.", 400);

  const status = payload.status && focusStatuses.has(payload.status) ? payload.status : "planned";
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const profileId = isOperationalLead ? payload.profileId || permission.profile?.id || "" : permission.profile?.id || "";
  const focusDate = payload.focusDate || todayIso();
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,owner")
    .eq("id", taskId)
    .single();
  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (!isOperationalLead && task.owner !== permission.profile?.id) {
    return apiError("Founder können nur eigene Aufgaben in den Fokus nehmen.", 403);
  }
  const { data: existingFocus } = await supabase
    .from("task_focus_items")
    .select("id,task_id")
    .eq("profile_id", profileId)
    .eq("focus_date", focusDate);
  const alreadyFocused = (existingFocus || []).some((item) => item.task_id === taskId);
  if (!alreadyFocused && (existingFocus || []).length >= 3) {
    return apiError("Heute-Fokus ist auf drei Aufgaben begrenzt.", 409);
  }

  const row = {
    profile_id: profileId,
    task_id: taskId,
    focus_date: focusDate,
    position: Math.max(1, Math.min(3, Math.round(Number(payload.position || 1)))),
    next_step: cleanText(payload.nextStep, 500),
    status,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("task_focus_items")
    .upsert(row, { onConflict: "profile_id,task_id,focus_date" })
    .select("id,profile_id,task_id,focus_date,position,next_step,status,created_at,updated_at")
    .single();

  if (error || !data) return apiError(error?.message || "Fokus konnte nicht gespeichert werden.", 500);

  await supabase.from("task_activity").insert({
    task_id: taskId,
    message: status === "done" ? "Fokus erledigt" : status === "needs_decision" ? "Fokus braucht Entscheidung" : "Fokus aktualisiert",
  });

  return NextResponse.json({ ok: true, focusItem: mapFocusItem(data) });
}

export async function DELETE(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireFounder(request);
  if (!permission.ok) return authzError(permission);

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return apiError("Fokus-Eintrag ist ungültig.", 400);

  const { data: focusItem, error: readError } = await supabase
    .from("task_focus_items")
    .select("id,task_id,profile_id")
    .eq("id", id)
    .single();
  if (readError || !focusItem) return apiError("Fokus-Eintrag nicht gefunden.", 404);
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  if (!isOperationalLead && focusItem.profile_id !== permission.profile?.id) {
    return apiError("Founder können nur eigene Fokus-Einträge entfernen.", 403);
  }

  const { error } = await supabase.from("task_focus_items").delete().eq("id", id);
  if (error) return apiError(error.message, 500);

  await supabase.from("task_activity").insert({
    task_id: focusItem.task_id,
    message: "Fokus entfernt",
  });

  return NextResponse.json({ ok: true });
}
