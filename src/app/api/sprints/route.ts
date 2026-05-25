import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

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
  namePattern?: string;
  rhythmWeeks?: number;
  horizonWeeks?: number;
  targetSprintNumber?: number;
};

const projectId = "findmydoc-founder-execution";

function sprintNumber(value: string) {
  const match = value.match(/sprint\D*(\d+)/i) || value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function sprintNameFromPattern(pattern: string, number: number) {
  const trimmed = pattern.trim() || "Sprint #";
  if (trimmed.includes("#")) return trimmed.replace(/#+/g, String(number));
  return `${trimmed} ${number}`;
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
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json().catch(() => ({}))) as CreateSprintPlanPayload;
  const namePattern = payload.namePattern?.trim() || "Sprint #";
  const rhythmWeeks = Math.min(Math.max(Number(payload.rhythmWeeks) || 2, 1), 12);
  const horizonWeeks = Math.min(Math.max(Number(payload.horizonWeeks) || 6, 1), 52);
  const targetSprintNumber = Math.max(Number(payload.targetSprintNumber) || 0, 0);

  const { data: existing, error: existingError } = await supabase
    .from("sprints")
    .select("id,name,status,start_date,end_date,review_due_at,score_locked")
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const sprints = (existing || []) as SprintRow[];
  const latest = sprints[sprints.length - 1];
  const existingIds = new Set(sprints.map((sprint) => sprint.id));
  const lastNumber = Math.max(0, ...sprints.map((sprint) => Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id))));
  const horizonEnd = addDaysIso(new Date().toISOString().slice(0, 10), horizonWeeks * 7);
  let nextNumber = lastNumber + 1;
  let nextStart = latest?.end_date ? addDaysIso(latest.end_date, 1) : new Date().toISOString().slice(0, 10);
  const inserts = [];

  while (nextStart <= horizonEnd || (targetSprintNumber > 0 && nextNumber <= targetSprintNumber)) {
    const endDate = addDaysIso(nextStart, rhythmWeeks * 7 - 1);
    const baseId = `sprint-${nextNumber}`;
    const id = existingIds.has(baseId) ? `${baseId}-${nextStart.replaceAll("-", "")}` : baseId;
    existingIds.add(id);
    inserts.push({
      id,
      project_id: projectId,
      name: sprintNameFromPattern(namePattern, nextNumber),
      status: "planning",
      start_date: nextStart,
      end_date: endDate,
      review_due_at: `${addDaysIso(endDate, -2)}T12:00:00.000Z`,
      score_locked: false,
    });
    nextNumber += 1;
    nextStart = addDaysIso(endDate, 1);
  }

  if (!inserts.length) return NextResponse.json({ ok: true, sprints: [] });

  const { data: created, error: insertError } = await supabase
    .from("sprints")
    .insert(inserts)
    .select("id,name,status,start_date,end_date,review_due_at,score_locked");

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.plan_create",
    entity_type: "sprint",
    entity_id: "bulk",
    after_data: { rhythmWeeks, horizonWeeks, targetSprintNumber, created: inserts.length },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, sprints: ((created || []) as SprintRow[]).map(mapSprint) });
}
