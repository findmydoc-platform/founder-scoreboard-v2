import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, isIsoDate } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { addDaysIso, sprintNumber } from "@/lib/planning-schedule";

type SprintRow = {
  id: string;
  name: string;
  status: "planning" | "active" | "review" | "closed";
  start_date: string | null;
  end_date: string | null;
  review_due_at: string | null;
  score_locked: boolean;
  updated_at: string;
};

type CreateSprintPlanPayload = {
  firstSprintNumber?: number;
  anchorStartDate?: string;
  rhythmWeeks?: number;
  horizonWeeks?: number;
  targetSprintNumber?: number;
};

const projectId = "findmydoc-founder-execution";

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
  const context = await requireJsonApiContext<CreateSprintPlanPayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
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
    .select("id,name,status,start_date,end_date,review_due_at,score_locked,updated_at")
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
      expected_updated_at: existingSprint?.updated_at || null,
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

  const weeklyRows = upserts.flatMap((sprint) => {
    const firstTitle = `${sprint.name} Weekly 1`;
    const secondTitle = `${sprint.name} Weekly 2`;
    return [
      {
        sprint_id: sprint.id,
        title: firstTitle,
        meeting_at: `${addDaysIso(sprint.start_date || new Date().toISOString().slice(0, 10), 6)}T18:00:00.000Z`,
        duration_minutes: 60,
        status: "planned",
        agenda: "Weekly Update, Blocker, Review-Stand und nächste Schritte.",
      },
      {
        sprint_id: sprint.id,
        title: secondTitle,
        meeting_at: `${sprint.end_date || sprint.start_date || new Date().toISOString().slice(0, 10)}T18:00:00.000Z`,
        duration_minutes: 60,
        status: "planned",
        agenda: "Weekly Update, Blocker, Review-Stand und nächste Schritte.",
      },
    ];
  });

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("create_sprint_plan_transaction", {
    p_sprints: upserts,
    p_meetings: weeklyRows,
    p_audit_data: {
      firstSprintNumber,
      anchorStartDate,
      rhythmWeeks,
      horizonWeeks,
      targetSprintNumber,
      protectedSprintIds: Array.from(protectedSprintIds),
    },
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (transactionError) {
    if (transactionError.code === "P0001") {
      return apiError("Sprint-Plan wurde parallel geändert oder enthält inzwischen geschützte Sprints. Bitte neu laden.", 409);
    }
    if (transactionError.code === "22023") return apiError("Sprint-Plan ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  const createdRows = (transactionData || []) as SprintRow[];

  return NextResponse.json({ ok: true, sprints: createdRows.map(mapSprint) });
}
