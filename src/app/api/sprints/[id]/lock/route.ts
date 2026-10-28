import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { computeFounderSprintScore, computeStrikeTransition } from "@/lib/founderops-scoring";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { Meeting, MeetingAttendance, Profile, SprintCommitment, Task } from "@/lib/types";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext, requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS, sprintReviewDueAt } from "@/lib/sprint-review-window";

type TaskRow = {
  id: string;
  updated_at: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  workstream: string | null;
  sort_order: number;
  estimate_hours: number | null;
  definition_of_done: string | null;
  evidence_link: string | null;
  issue_number: string | null;
  issue_url: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  sprint_id: string | null;
  review_status: string | null;
  score_points: number | null;
  score_final: boolean | null;
  task_type: string | null;
  approval_status: string | null;
  score_relevant: boolean | null;
  carryover_count: number | null;
  original_sprint_id: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  dod_template_version: string | null;
  sprint_outcome: string | null;
};

type StoredSprintLockResult = {
  sprint?: { id?: string; status?: string; scoreLocked?: boolean };
  carryover?: { nextSprintId?: string; created?: number; evaluated?: number };
  scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number };
  replayed?: boolean;
};

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}

function sprintOutcome(task: TaskRow, hasOpenBlocker: boolean) {
  if (task.review_status === "changes_requested" || normalizeStatus(task.status).includes("nacharbeit")) return "rework";
  if (hasOpenBlocker || normalizeStatus(task.status).includes("block")) return "communicated_blocker";
  if (task.review_status === "requested" || normalizeStatus(task.status).includes("review")) return "missed_no_review";
  return "missed_uncommunicated";
}

function carryoverReason(outcome: string) {
  const reasons: Record<string, string> = {
    rework: "Nacharbeit aus Review wird in den nächsten Sprint übertragen.",
    communicated_blocker: "Blocker wurde kommuniziert; Deliverable wird planbar übertragen.",
    missed_no_review: "Review war offen oder nicht abgeschlossen; Deliverable wird übertragen.",
    missed_uncommunicated: "Deliverable wurde nicht rechtzeitig finalisiert oder kommuniziert.",
  };
  return reasons[outcome] || "Deliverable wurde in den nächsten Sprint übertragen.";
}

type LockPayload = { expectedUpdatedAt?: string; expectedTasks?: {id:string;updatedAt:string}[] };
const complete = (result:{data:unknown;count?:number|null}) => Array.isArray(result.data) && result.count === result.data.length;
function mapSprint(row:{id:string;name:string;status:string;start_date:string|null;end_date:string|null;review_due_at:string|null;score_locked:boolean;updated_at:string}) { return {id:row.id,name:row.name,status:row.status,startDate:row.start_date||"",endDate:row.end_date||"",reviewDueAt:row.review_due_at||"",scoreLocked:row.score_locked,updatedAt:row.updated_at}; }
function conflict(error:string,code:string,status=409){return NextResponse.json({error,code},{status});}
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params;const authorized=await requirePlanningContext(request,"planning.sprint.lock",id);if(!authorized.ok)return authorized.response;
 const {planning}=authorized;const observed=await planning.readSprintLock();if(observed.error||!observed.data)return apiError("Sprint-Abschluss kann nicht geladen werden.", observed.error?.code === "42501" ? 403 : 404);
 const sprint=observed.data;const stored=sprint.lock_result as StoredSprintLockResult|null;
 const receipt=sprint.score_locked&&stored?.sprint?.id===id&&stored.sprint.scoreLocked&&stored.sprint.status==="closed"?stored:null;
 if(receipt)return NextResponse.json({basis:{sprint:mapSprint(sprint),tasks:[]},tasksComplete:false,receipt});
 const tasks=await planning.readSprintTaskRows();if(tasks.error)return apiError("Sprint-Aufgaben können nicht geladen werden.",503);if(!complete(tasks))return conflict("Die Aufgabenbasis ist unvollständig. Der Abschluss wurde nicht ausgeführt.","sprint_lock_incomplete");
 return NextResponse.json({basis:{sprint:mapSprint(sprint),tasks:(tasks.data||[]).map(task=>({id:task.id,title:task.title,updatedAt:task.updated_at}))},tasksComplete:true,receipt:null});
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<LockPayload>(request, "planning.sprint.lock", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const { permission, planning, payload } = apiContext;

  const { data: sprint, error: sprintError } = await planning.readSprintLock();

  if (sprintError || !sprint) return apiError("Sprint wurde nicht gefunden.", 404);
  if (sprint.score_locked) {
    const storedResult = sprint.lock_result as StoredSprintLockResult | null;
    if (storedResult?.sprint) return NextResponse.json({ ok: true, ...storedResult, replayed: true });
    return apiError("Sprint ist bereits gelockt.", 409);
  }

  if(typeof payload.expectedUpdatedAt!=="string"||!payload.expectedUpdatedAt||!Array.isArray(payload.expectedTasks)||payload.expectedTasks.some(task=>!task||typeof task.id!=="string"||!task.id||typeof task.updatedAt!=="string"||!task.updatedAt)||new Set(payload.expectedTasks.map(task=>task.id)).size!==payload.expectedTasks.length)return conflict("Die ursprüngliche Sprint- und Aufgabenbasis fehlt.","sprint_lock_basis_missing",400);
  if(payload.expectedUpdatedAt!==sprint.updated_at)return conflict("Der Sprint wurde zwischenzeitlich geändert. Bitte den Serverstand vergleichen.","sprint_lock_conflict");

  const objectionResult=await planning.readSprintBlockingObjections();
  const { data: blockingObjections, error: objectionError } = objectionResult;

  if (objectionError) return apiError(objectionError.message, 500);
  if(!complete(objectionResult))return conflict("Die Einwandbasis ist unvollständig.","sprint_lock_incomplete");
  const unresolvedObjection = (blockingObjections || []).find((objection) =>
    objection.status === "open" || Boolean(objection.second_reviewer_profile_id && !objection.second_reviewed_at)
  );
  if (unresolvedObjection) {
    return conflict("Offene oder ausstehende Score-Einwände müssen vor dem Sprint-Lock abgeschlossen werden.","sprint_lock_objections");
  }

  const adjustmentResult=await planning.readSprintAcceptedAdjustments();
  const { data: acceptedAdjustments, error: acceptedAdjustmentError } = adjustmentResult;

  if (acceptedAdjustmentError) return apiError(acceptedAdjustmentError.message, 500);
  if(!complete(adjustmentResult))return conflict("Die Bewertungsbasis ist unvollständig.","sprint_lock_incomplete");

  const acceptedAdjustmentByProfile = new Map<string, {
    resolved_delivery_points: number;
    resolved_form_points: number;
    resolved_weekly_points: number;
  }>();
  for (const adjustment of acceptedAdjustments || []) {
    if (!acceptedAdjustmentByProfile.has(adjustment.profile_id)) {
      acceptedAdjustmentByProfile.set(adjustment.profile_id, adjustment as {
        resolved_delivery_points: number;
        resolved_form_points: number;
        resolved_weekly_points: number;
      });
    }
  }

  let reviewDueAt = sprint.review_due_at || "";
  if (!reviewDueAt) {
    const { data: project, error: projectError } = await planning.readSprintLockProject();

    if (projectError || !project) return apiError("FounderOps-Prozesseinstellungen wurden nicht gefunden.", 409);
    reviewDueAt = sprintReviewDueAt(
      sprint.end_date || "",
      Number(project.review_objection_window_hours || DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS),
    );
  }
  if (!reviewDueAt) return apiError("Reviewfrist konnte nicht aus dem Sprint-Ende abgeleitet werden.", 409);
  if (new Date(reviewDueAt).getTime() > Date.now()) {
    return conflict("Die Review- und Einwandfrist läuft noch. Der Sprint kann erst danach finalisiert werden.","sprint_lock_window");
  }

  const { data: nextSprint, error: nextSprintError } = await planning.readNextSprint();

  if (nextSprintError) return apiError(nextSprintError.message, 500);

  const taskResult=await planning.readSprintTaskRows();
  const { data: tasks, error: tasksError } = taskResult;

  if (tasksError) return apiError(tasksError.message, 500);
  if(!complete(taskResult))return conflict("Die Aufgabenbasis ist unvollständig.","sprint_lock_incomplete");
  const expectedTasks=new Map(payload.expectedTasks.map(task=>[task.id,task.updatedAt]));
  if(expectedTasks.size!==(tasks||[]).length||(tasks||[]).some(task=>expectedTasks.get(task.id)!==task.updated_at))return conflict("Die angezeigten Sprint-Aufgaben wurden zwischenzeitlich geändert. Bitte den Serverstand vergleichen.","sprint_lock_tasks_conflict");

  const sprintTasks = (tasks || []) as TaskRow[];
  const carryoverTasks = sprintTasks.filter((task) =>
    task.task_type === "deliverable"
    && task.approval_status === "approved"
    && task.score_relevant !== false
    && !task.score_final
  );
  const taskIds = carryoverTasks.map((task) => task.id);

  const blockerResult = taskIds.length
    ? await planning.readSprintBlockers(taskIds)
    : { data: [], count: 0 };
  if ("error" in blockerResult && blockerResult.error) return apiError(blockerResult.error.message, 500);
  if(!complete(blockerResult))return conflict("Die Blockerbasis ist unvollständig.","sprint_lock_incomplete");
  const openBlockerTaskIds = new Set((blockerResult.data || []).map((blocker: { task_id: string }) => blocker.task_id));

  const carryoverInserts = [];
  const notifications: ReturnType<typeof createNotificationPayload>[] = [];
  const taskUpdates = [];
  const acceptedBlockerTaskIds = [];
  const now = new Date().toISOString();

  for (const task of carryoverTasks) {
    const outcome = sprintOutcome(task, openBlockerTaskIds.has(task.id));
    const reason = carryoverReason(outcome);
    taskUpdates.push({
      id: task.id,
      score_points: 0,
      score_final: true,
      sprint_outcome: outcome,
      carryover_reason: reason,
      github_issue_sync_status: "not_synced",
      github_issue_sync_error: null,
    });

    if (outcome === "communicated_blocker") {
      acceptedBlockerTaskIds.push(task.id);
    }

    if (nextSprint?.id) {
      carryoverInserts.push(buildTaskInsertRow({
        id: `${task.id}-carryover-${nextSprint.id}`,
        projectId: task.project_id,
        parentTaskId: task.parent_task_id,
        title: task.title,
        description: task.description,
        problemStatement: task.problem_statement,
        intendedOutcome: task.intended_outcome,
        scopeConstraints: task.scope_constraints,
        acceptanceCriteria: task.acceptance_criteria,
        evidenceRequired: task.evidence_required,
        dodTemplateVersion: task.dod_template_version,
        status: outcome === "communicated_blocker" ? "Blockiert" : "Offen",
        priority: task.priority,
        owner: task.owner || task.assignee,
        assignee: task.assignee || task.owner,
        workstream: task.workstream,
        sortOrder: task.sort_order + 10000,
        fixedDate: null,
        hours: task.estimate_hours,
        definitionOfDone: task.definition_of_done,
        evidenceLink: task.evidence_link,
        sprintId: null,
        taskType: "deliverable",
        scoreRelevant: false,
        approvalStatus: "proposed",
        proposedById: permission.profile?.id || null,
        proposedAt: now,
        originalSprintId: task.original_sprint_id || id,
        carriedFromTaskId: task.id,
        carriedFromSprintId: id,
        carryoverReason: reason,
        carryoverCount: Number(task.carryover_count || 0) + 1,
      }));

      const assignee = task.assignee || task.owner;
      if (assignee) {
        notifications.push(createNotificationPayload("sprint.task_carried_over", {
          actorProfileId: permission.profile?.id,
          recipientProfileId: assignee,
          entityType: "task",
          entityId: task.id,
          title: `Carry-over: ${task.title}`,
          body: `${reason}\nAls Deliverable-Vorschlag angelegt. Vor einer Sprint-Zuordnung ist eine Freigabe erforderlich.`,
        }));
      }
    }
  }

  const [
    profileResult,
    commitmentResult,
    meetingResult,
    attendanceResult,
    strikeStateResult,
  ] = await planning.readSprintScoringInputs();

  if (profileResult.error) return apiError(profileResult.error.message, 500);
  if (commitmentResult.error) return apiError(commitmentResult.error.message, 500);
  if (meetingResult.error) return apiError(meetingResult.error.message, 500);
  if (attendanceResult.error) return apiError(attendanceResult.error.message, 500);
  if (strikeStateResult.error) return apiError(strikeStateResult.error.message, 500);

  if(![profileResult,commitmentResult,meetingResult,attendanceResult,strikeStateResult].every(complete))return conflict("Die Bewertungsgrundlagen wurden nicht vollständig geladen.","sprint_lock_incomplete");

  const profiles = (profileResult.data || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    platformRole: profile.platform_role || "founder",
    orgRole: "",
    githubLogin: "",
    weeklyCapacity: profile.weekly_capacity || 0,
  })) as Profile[];
  const profileNameById = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const scoringTasks = sprintTasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    assigneeId: task.assignee || task.owner || "",
    assignee: task.assignee ? profileNameById.get(task.assignee) || task.assignee : task.owner ? profileNameById.get(task.owner) || task.owner : "",
    ownerId: task.owner || task.assignee || "",
    owner: task.owner ? profileNameById.get(task.owner) || task.owner : task.assignee ? profileNameById.get(task.assignee) || task.assignee : "",
    reviewStatus: (task.review_status || "not_requested") as Task["reviewStatus"],
    scorePoints: Number(task.score_points || 0),
    scoreFinal: Boolean(task.score_final),
    taskType: (task.task_type || "deliverable") as Task["taskType"],
    scoreRelevant: task.score_relevant !== false,
    definitionOfDone: task.definition_of_done || "",
    evidenceLink: task.evidence_link || "",
    githubIssueUrl: task.github_issue_url || "",
    issueUrl: task.issue_url || "",
    sprintOutcome: (task.sprint_outcome || "") as Task["sprintOutcome"],
  })) as Task[];
  const commitments = (commitmentResult.data || []).map((commitment) => ({
    id: commitment.id,
    sprintId: commitment.sprint_id,
    profileId: commitment.profile_id,
    commitmentLevel: commitment.commitment_level,
    weeklyHours: commitment.weekly_hours,
    note: commitment.note || "",
  })) as SprintCommitment[];
  const meetings = (meetingResult.data || []).map((meeting) => ({
    id: meeting.id,
    sprintId: meeting.sprint_id,
    title: meeting.title,
    meetingAt: meeting.meeting_at,
    durationMinutes: meeting.duration_minutes || 60,
    status: meeting.status,
    agenda: meeting.agenda || "",
  })) as Meeting[];
  const meetingAttendance = (attendanceResult.data || []).map((attendance) => ({
    id: attendance.id,
    meetingId: attendance.meeting_id,
    profileId: attendance.profile_id,
    status: attendance.status,
    absenceReason: attendance.absence_reason || "",
    reasonAccepted: attendance.reason_accepted,
    writtenUpdate: attendance.written_update || "",
    points: attendance.points,
    createdAt: attendance.created_at,
    updatedAt: attendance.updated_at,
  })) as MeetingAttendance[];
  const strikeStateByProfile = new Map((strikeStateResult.data || []).map((state) => [state.profile_id, state]));
  const scoreRows = [];
  const strikeStateRows = [];
  const strikeEvents = [];

  for (const profile of profiles) {
    const computedScore = computeFounderSprintScore({
      profile,
      tasks: scoringTasks,
      commitment: commitments.find((item) => item.profileId === profile.id),
      meetings,
      meetingAttendance,
    });
    const acceptedAdjustment = acceptedAdjustmentByProfile.get(profile.id);
    const adjustedTotal = acceptedAdjustment
      ? acceptedAdjustment.resolved_delivery_points + acceptedAdjustment.resolved_form_points + acceptedAdjustment.resolved_weekly_points
      : computedScore.totalPoints;
    const score = acceptedAdjustment
      ? {
        ...computedScore,
        deliveryPoints: acceptedAdjustment.resolved_delivery_points,
        formPoints: acceptedAdjustment.resolved_form_points,
        weeklyPoints: acceptedAdjustment.resolved_weekly_points,
        totalPoints: adjustedTotal,
        fulfilled: !computedScore.awayNeutral && adjustedTotal >= 12,
        reasonSummary: `Korrigiert nach angenommenem Score-Einwand: Delivery ${acceptedAdjustment.resolved_delivery_points}/12, Form / Review-Reife ${acceptedAdjustment.resolved_form_points}/4, Weekly ${acceptedAdjustment.resolved_weekly_points}/4.`,
      }
      : computedScore;
    const state = strikeStateByProfile.get(profile.id);
    const transition = computeStrikeTransition(score, state ? {
      strikeLevel: state.strike_level,
      fulfilledResetStreak: state.fulfilled_reset_streak,
    } : null);

    scoreRows.push({
      sprint_id: id,
      profile_id: profile.id,
      delivery_points: score.deliveryPoints,
      form_points: score.formPoints,
      weekly_points: score.weeklyPoints,
      total_points: score.totalPoints,
      fulfilled: score.fulfilled,
      away_neutral: score.awayNeutral,
      finalized_at: now,
      finalized_by: permission.profile?.id || null,
      reason_summary: score.reasonSummary,
    });

    strikeStateRows.push({
      profile_id: profile.id,
      strike_level: transition.nextStrikeLevel,
      fulfilled_reset_streak: transition.fulfilledResetStreak,
      last_evaluated_sprint_id: id,
      updated_at: now,
    });

    strikeEvents.push({
      profile_id: profile.id,
      sprint_id: id,
      event_type: transition.eventType,
      previous_strike_level: transition.previousStrikeLevel,
      next_strike_level: transition.nextStrikeLevel,
      reason: transition.reason,
      created_by: permission.profile?.id || null,
    });
  }

  const resultData = {
    carryover: {
      nextSprintId: nextSprint?.id || "",
      created: carryoverInserts.length,
      evaluated: carryoverTasks.length,
    },
    scoring: {
      scores: scoreRows.length,
      strikeEvents: strikeEvents.length,
      governanceReviews: strikeEvents.filter((event) => event.event_type === "governance_review_required").length,
    },
  };
  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await planning.commitSprintLock({
    expectedUpdatedAt: payload.expectedUpdatedAt, expectedTasks: payload.expectedTasks, taskUpdates, acceptedBlockerTaskIds, carryoverInserts, notifications,
    scoreRows, strikeStateRows, strikeEvents, resultData,
  }, metadata);

  if (transactionError) {
    if (transactionError.code === "P0001") return conflict("Sprint wurde parallel geändert. Bitte den Serverstand vergleichen.","sprint_lock_conflict");
    if (transactionError.code === "P0007") return conflict("Sprint-Aufgaben wurden parallel geändert. Bitte den Serverstand vergleichen.","sprint_lock_tasks_conflict");
    if (transactionError.code === "P0002") return apiError("Sprint wurde nicht gefunden.", 404);
    if (transactionError.code === "P0004") return conflict("Offene Score-Einwände müssen vor dem Lock abgeschlossen werden.","sprint_lock_objections");
    if (transactionError.code === "P0006") return conflict("Die Review- und Einspruchsfrist ist noch offen.","sprint_lock_window");
    if (transactionError.code === "22023") return apiError("Sprint-Finalisierung ist ungültig.", 400);
    if (transactionError.code === "23505") return apiError("Carry-over wurde bereits angelegt. Bitte neu laden.", 409);
    return apiError(transactionError.message, 500);
  }

  const finalized = transactionData as StoredSprintLockResult | null;
  return NextResponse.json({ ok: true, ...(finalized || resultData) });
}
