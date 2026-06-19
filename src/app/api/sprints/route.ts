import { NextResponse, type NextRequest } from "next/server";
import { isIsoDate } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type SprintRow = {
  id: string;
  name: string;
  status: "planning" | "active" | "review" | "closed";
  start_date: string | null;
  end_date: string | null;
  review_due_at: string | null;
  score_locked: boolean;
};

type CreateSprintPlanPayload = {
  firstSprintNumber?: number;
  anchorStartDate?: string;
  rhythmWeeks?: number;
  horizonWeeks?: number;
  targetSprintNumber?: number;
};

const projectId = "findmydoc-founder-execution";

function sprintNumber(value: string) {
  const match = value.match(/sprint\D*(\d+)/i) || value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function addDaysIso(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mapSprint(row: SprintRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    reviewDueAt: row.review_due_at || "",
    scoreLocked: row.score_locked,
  };
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return authzError(permission);

  const payload = (await request.json().catch(() => ({}))) as CreateSprintPlanPayload;
  const firstSprintNumber = Math.max(Number(payload.firstSprintNumber) || 1, 1);
  const anchorStartDate = payload.anchorStartDate?.trim() || new Date().toISOString().slice(0, 10);
  const rhythmWeeks = Math.min(Math.max(Number(payload.rhythmWeeks) || 2, 1), 12);
  const horizonWeeks = Math.min(Math.max(Number(payload.horizonWeeks) || 6, 1), 52);
  const targetSprintNumber = Math.max(Number(payload.targetSprintNumber) || 0, 0);

  if (!isIsoDate(anchorStartDate)) {
    return apiError("Startdatum der Sprint-Planung ist ungültig.", 400);
  }

  const { data: existing, error: existingError } = await supabase
    .from("sprints")
    .select("id,name,status,start_date,end_date,review_due_at,score_locked")
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  if (existingError) return apiError(existingError.message, 500);

  const { data: assignedTasks, error: assignedTasksError } = await supabase
    .from("tasks")
    .select("sprint_id")
    .not("sprint_id", "is", null);

  if (assignedTasksError) return apiError(assignedTasksError.message, 500);

  const protectedSprintIds = new Set((assignedTasks || []).map((task) => task.sprint_id).filter(Boolean));
  const sprints = (existing || []) as SprintRow[];
  const existingIds = new Set(sprints.map((sprint) => sprint.id));
  const sprintByNumber = new Map<number, SprintRow>();
  for (const sprint of sprints) {
    const number = Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id));
    if (number > 0) sprintByNumber.set(number, sprint);
  }
  const horizonEnd = addDaysIso(new Date().toISOString().slice(0, 10), horizonWeeks * 7);
  let nextNumber = firstSprintNumber;
  let nextStart = anchorStartDate;
  const upserts = [];

  while (nextStart <= horizonEnd || (targetSprintNumber > 0 && nextNumber <= targetSprintNumber)) {
    const endDate = addDaysIso(nextStart, rhythmWeeks * 7 - 1);
    const existingSprint = sprintByNumber.get(nextNumber);
    const baseId = `sprint-${nextNumber}`;
    const id = existingSprint?.id || (existingIds.has(baseId) ? `${baseId}-${nextStart.replaceAll("-", "")}` : baseId);
    existingIds.add(id);
    const row = {
      id,
      project_id: projectId,
      name: `Sprint ${nextNumber}`,
      status: existingSprint?.status || "planning",
      start_date: nextStart,
      end_date: endDate,
      review_due_at: `${addDaysIso(endDate, -2)}T12:00:00.000Z`,
      score_locked: existingSprint?.score_locked || false,
    };
    const changed = existingSprint && (
      existingSprint.name !== row.name
      || existingSprint.start_date !== row.start_date
      || existingSprint.end_date !== row.end_date
      || (existingSprint.review_due_at || "").slice(0, 16) !== row.review_due_at.slice(0, 16)
    );
    if (!existingSprint || (!existingSprint.score_locked && !protectedSprintIds.has(existingSprint.id) && changed)) {
      upserts.push(row);
    }
    nextNumber += 1;
    nextStart = addDaysIso(endDate, 1);
  }

  if (!upserts.length) return NextResponse.json({ ok: true, sprints: [] });

  const { data: created, error: insertError } = await supabase
    .from("sprints")
    .upsert(upserts, { onConflict: "id" })
    .select("id,name,status,start_date,end_date,review_due_at,score_locked");

  if (insertError) return apiError(insertError.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.plan_create",
    entity_type: "sprint",
    entity_id: "bulk",
    after_data: { firstSprintNumber, anchorStartDate, rhythmWeeks, horizonWeeks, targetSprintNumber, upserted: upserts.length, protectedSprintIds: Array.from(protectedSprintIds) },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, sprints: ((created || []) as SprintRow[]).map(mapSprint) });
}
