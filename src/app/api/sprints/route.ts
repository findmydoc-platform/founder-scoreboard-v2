import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, isIsoDate } from "@/lib/api-input";
import { apiError } from "@/lib/api-response";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { addDaysIso, sprintNumber } from "@/lib/planning-schedule";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS, sprintReviewDueAt } from "@/lib/sprint-review-window";

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
  expectedSprints?: { id: string; number?: number; updatedAt?: string }[];
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
    updatedAt: row.updated_at,
  };
}

export async function POST(request: NextRequest) {
  const context = await requirePlanningJsonContext<CreateSprintPlanPayload>(request, "planning.sprint.plan", {});
  if (!context.ok) return context.response;

  const { payload, planning } = context;
  if (!Array.isArray(payload.expectedSprints) || payload.expectedSprints.some(row => !row || typeof row.id !== "string" || !row.id || (row.number !== undefined && (!Number.isInteger(row.number) || row.number < 0)) || (row.updatedAt !== undefined && (typeof row.updatedAt !== "string" || !row.updatedAt)))) return apiError("Lade den Sprint-Plan neu, bevor du speicherst.", 400);
  const expected = new Map(payload.expectedSprints.map(row => [row.id, row.updatedAt]));
  const displayedByNumber = new Map(payload.expectedSprints.map(row => [row.number ?? sprintNumber(row.id), row]));
  const firstSprintNumber = Math.max(Number(payload.firstSprintNumber) || 1, 1);
  const anchorStartDate = payload.anchorStartDate?.trim() || new Date().toISOString().slice(0, 10);
  const rhythmWeeks = Math.min(Math.max(Number(payload.rhythmWeeks) || 2, 1), 12);
  const horizonWeeks = Math.min(Math.max(Number(payload.horizonWeeks) || 6, 1), 52);
  const targetSprintNumber = Math.max(Number(payload.targetSprintNumber) || 0, 0);

  if (!isIsoDate(anchorStartDate)) {
    return apiError("Startdatum der Sprint-Planung ist ungültig.", 400);
  }

  const { data: project, error: projectError } = await planning.readSprintPlanProject();

  if (projectError || !project) return apiError("FounderOps-Prozesseinstellungen wurden nicht gefunden.", 409);
  const reviewObjectionWindowHours = Number(project.review_objection_window_hours || DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS);

  const existingRead = await planning.readPlannedSprints();
  const { data: existing, error: existingError } = existingRead;
  const existingCount = "count" in existingRead ? existingRead.count : null;

  if (existingError) return apiError(existingError.message, 500);
  if (existingCount === null || existingCount === undefined || existingCount !== (existing || []).length) return NextResponse.json({ error: "Der vorhandene Sprint-Plan wurde nicht vollständig geladen. Es wurde nichts geändert.", code: "sprint_plan_incomplete" }, { status: 409 });

  const { data: assignedTasks, error: assignedTasksError } = await planning.readAssignedSprintIds();

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
    const displayedSprint = displayedByNumber.get(nextNumber);
    if (displayedSprint && (!existingSprint || displayedSprint.id !== existingSprint.id)) return NextResponse.json({ error: "Die Sprint-Zuordnung wurde zwischenzeitlich geändert. Vergleiche die Änderungen.", code: "sprint_plan_conflict" }, { status: 409 });
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
      review_due_at: sprintReviewDueAt(endDate, reviewObjectionWindowHours),
      score_locked: existingSprint?.score_locked || false,
      expected_updated_at: expected.get(id) || null,
    };
    const changed = existingSprint && (
      existingSprint.name !== row.name
      || existingSprint.start_date !== row.start_date
      || existingSprint.end_date !== row.end_date
      || (existingSprint.review_due_at || "").slice(0, 16) !== row.review_due_at.slice(0, 16)
    );
    if (!existingSprint || (!existingSprint.score_locked && !protectedSprintIds.has(existingSprint.id) && changed)) {
      if (existingSprint && !expected.has(id)) return NextResponse.json({ error: "Der Sprint war nicht Teil der angezeigten Planungsbasis. Vergleiche die Änderungen.", code: "sprint_plan_conflict" }, { status: 409 });
      if (existingSprint && !expected.get(id)) return apiError("Die ursprüngliche Sprint-Version fehlt. Bitte neu laden.", 400);
      if (existingSprint && expected.get(id) !== existingSprint.updated_at) return NextResponse.json({ error: "Der Sprint-Plan wurde zwischenzeitlich geändert. Vergleiche die Änderungen.", code: "sprint_plan_conflict" }, { status: 409 });
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
  const { data: transactionData, error: transactionError } = await planning.commitSprintPlan({
    sprints: upserts,
    meetings: weeklyRows,
    auditData: {
      firstSprintNumber,
      anchorStartDate,
      rhythmWeeks,
      horizonWeeks,
      targetSprintNumber,
      reviewObjectionWindowHours,
      protectedSprintIds: Array.from(protectedSprintIds),
    },
  }, metadata);
  if (transactionError) {
    if (transactionError.code === "P0001") {
      return NextResponse.json({ error: "Sprint-Plan wurde parallel geändert oder enthält inzwischen geschützte Sprints. Vergleiche die Änderungen.", code: "sprint_plan_changed_or_protected" }, { status: 409 });
    }
    if (transactionError.code === "22023") return apiError("Sprint-Plan ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  const createdRows = (transactionData || []) as SprintRow[];

  return NextResponse.json({ ok: true, sprints: createdRows.map(mapSprint) });
}
