import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { computeFounderSprintScore, computeStrikeTransition } from "@/lib/founderops-scoring";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { Meeting, MeetingAttendance, Profile, SprintCommitment, Task } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type TaskRow = {
  id: string;
  project_id: string;
  package_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  workstream: string | null;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  deadline: string | null;
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
  score_relevant: boolean | null;
  carryover_count: number | null;
  original_sprint_id: string | null;
  milestone_id: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  dod_template_version: string | null;
  sprint_outcome: string | null;
};

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}

function sprintOutcome(task: TaskRow, hasOpenBlocker: boolean) {
  if (task.review_status === "partial") return "partial";
  if (task.review_status === "changes_requested" || normalizeStatus(task.status).includes("nacharbeit")) return "rework";
  if (hasOpenBlocker || normalizeStatus(task.status).includes("block")) return "communicated_blocker";
  if (task.review_status === "requested" || normalizeStatus(task.status).includes("review")) return "missed_no_review";
  return "missed_uncommunicated";
}

function carryoverReason(outcome: string) {
  const reasons: Record<string, string> = {
    partial: "Teilweise akzeptiert, Restarbeit wird in den nächsten Sprint übertragen.",
    rework: "Nacharbeit aus Review wird in den nächsten Sprint übertragen.",
    communicated_blocker: "Blocker wurde kommuniziert; Deliverable wird planbar übertragen.",
    missed_no_review: "Review war offen oder nicht abgeschlossen; Deliverable wird übertragen.",
    missed_uncommunicated: "Deliverable wurde nicht rechtzeitig finalisiert oder kommuniziert.",
  };
  return reasons[outcome] || "Deliverable wurde in den nächsten Sprint übertragen.";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<{ finalizeNow?: boolean }>(request, requireOperationalLead, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;

  const { id } = await context.params;

  const { data: sprint, error: sprintError } = await supabase
    .from("sprints")
    .select("id,name,start_date,end_date,review_due_at,score_locked")
    .eq("id", id)
    .single();

  if (sprintError || !sprint) return apiError("Sprint wurde nicht gefunden.", 404);
  if (sprint.score_locked) return apiError("Sprint ist bereits gelockt.", 409);

  const { count: openObjections, error: objectionError } = await supabase
    .from("score_objections")
    .select("*", { count: "exact", head: true })
    .eq("sprint_id", id)
    .eq("status", "open");
  if (objectionError) return apiError(objectionError.message, 500);
  if ((openObjections || 0) > 0) {
    return apiError("Offene Score-Einwände müssen vor dem Sprint-Lock geprüft werden.", 409);
  }

  if (sprint.review_due_at && new Date(sprint.review_due_at).getTime() > Date.now() && !payload.finalizeNow) {
    return apiError("Reviewfrist läuft noch. Operational Lead muss die Finalisierung explizit bestätigen.", 409);
  }

  const { data: nextSprint } = await supabase
    .from("sprints")
    .select("id,name,start_date,end_date")
    .neq("id", id)
    .gt("start_date", sprint.start_date || "1900-01-01")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id,project_id,package_id,title,description,status,priority,owner,assignee,workstream,sort_order,start_date,end_date,deadline,estimate_hours,definition_of_done,evidence_link,issue_number,issue_url,github_issue_number,github_issue_url,sprint_id,review_status,score_points,score_final,task_type,score_relevant,carryover_count,original_sprint_id,milestone_id,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,dod_template_version,sprint_outcome")
    .eq("sprint_id", id);

  if (tasksError) return apiError(tasksError.message, 500);

  const sprintTasks = (tasks || []) as TaskRow[];
  const carryoverTasks = sprintTasks.filter((task) =>
    task.task_type !== "sub_issue"
    && task.score_relevant !== false
    && (!task.score_final || task.review_status === "partial")
  );
  const taskIds = carryoverTasks.map((task) => task.id);

  const blockerResult = taskIds.length
    ? await supabase.from("task_blockers").select("id,task_id,status").in("task_id", taskIds).eq("status", "open")
    : { data: [] };
  const openBlockerTaskIds = new Set((blockerResult.data || []).map((blocker: { task_id: string }) => blocker.task_id));

  const carryoverInserts = [];
  const notifications = [];
  const nowSuffix = Date.now().toString(36);

  for (const task of carryoverTasks) {
    const outcome = sprintOutcome(task, openBlockerTaskIds.has(task.id));
    const reason = carryoverReason(outcome);
    const preserveScore = outcome === "partial";

    await supabase
      .from("tasks")
      .update({
        score_points: preserveScore ? Number(task.score_points || 0) : 0,
        score_final: true,
        sprint_outcome: outcome,
        carryover_reason: reason,
        github_sync_status: "not_synced",
        github_sync_error: null,
      })
      .eq("id", task.id);

    if (outcome === "communicated_blocker") {
      await supabase.from("task_blockers").update({ status: "accepted_carryover" }).eq("task_id", task.id).eq("status", "open");
    }

    if (nextSprint?.id) {
      carryoverInserts.push(buildTaskInsertRow({
        id: `${task.id}-carryover-${nowSuffix}`,
        projectId: task.project_id,
        packageId: task.package_id,
        milestoneId: task.milestone_id,
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
        startDate: nextSprint.start_date || null,
        endDate: nextSprint.end_date || null,
        deadline: nextSprint.end_date || null,
        hours: task.estimate_hours,
        definitionOfDone: task.definition_of_done,
        evidenceLink: task.evidence_link,
        sprintId: nextSprint.id,
        taskType: "deliverable",
        scoreRelevant: true,
        originalSprintId: task.original_sprint_id || id,
        carriedFromTaskId: task.id,
        carriedFromSprintId: id,
        carryoverReason: reason,
        carryoverCount: Number(task.carryover_count || 0) + 1,
      }));

      const assignee = task.assignee || task.owner;
      if (assignee) {
        notifications.push({
          type: "sprint.task_carried_over",
          actor_profile_id: permission.profile?.id || null,
          recipient_profile_id: assignee,
          entity_type: "task",
          entity_id: task.id,
          title: `Carry-over: ${task.title}`,
          body: `${reason}\nNeuer Sprint: ${nextSprint.name || nextSprint.id}`,
        });
      }
    }
  }

  if (carryoverInserts.length) {
    const { error: carryoverError } = await supabase.from("tasks").insert(carryoverInserts);
    if (carryoverError) return apiError(carryoverError.message, 500);
  }

  if (notifications.length) {
    await supabase.from("notification_events").insert(notifications);
  }

  const { error: freezeError } = await supabase
    .from("tasks")
    .update({ score_points: 0, score_final: true, sprint_outcome: "missed_uncommunicated" })
    .eq("sprint_id", id)
    .eq("score_final", false);

  if (freezeError) return apiError(freezeError.message, 500);

  const [
    profileResult,
    commitmentResult,
    meetingResult,
    attendanceResult,
    strikeStateResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id,name,role,platform_role,weekly_capacity"),
    supabase.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note").eq("sprint_id", id),
    supabase.from("meetings").select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda").eq("sprint_id", id).order("meeting_at"),
    supabase.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at"),
    supabase.from("founder_strike_state").select("id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at"),
  ]);

  if (profileResult.error) return apiError(profileResult.error.message, 500);
  if (commitmentResult.error) return apiError(commitmentResult.error.message, 500);
  if (meetingResult.error) return apiError(meetingResult.error.message, 500);
  if (attendanceResult.error) return apiError(attendanceResult.error.message, 500);
  if (strikeStateResult.error) return apiError(strikeStateResult.error.message, 500);

  const profiles = (profileResult.data || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role || "member",
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
  const now = new Date().toISOString();

  for (const profile of profiles) {
    const score = computeFounderSprintScore({
      profile,
      tasks: scoringTasks,
      commitment: commitments.find((item) => item.profileId === profile.id),
      meetings,
      meetingAttendance,
    });
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

  if (scoreRows.length) {
    const { error: scoreError } = await supabase.from("founder_sprint_scores").upsert(scoreRows, { onConflict: "sprint_id,profile_id" });
    if (scoreError) return apiError(scoreError.message, 500);
  }

  if (strikeStateRows.length) {
    const { error: strikeStateError } = await supabase.from("founder_strike_state").upsert(strikeStateRows, { onConflict: "profile_id" });
    if (strikeStateError) return apiError(strikeStateError.message, 500);
  }

  if (strikeEvents.length) {
    const { error: strikeError } = await supabase.from("strike_events").insert(strikeEvents);
    if (strikeError) return apiError(strikeError.message, 500);
  }

  const { error: updateError } = await supabase
    .from("sprints")
    .update({ score_locked: true, status: "closed", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) return apiError(updateError.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "sprint.lock_score",
    entity_type: "sprint",
    entity_id: id,
    after_data: {
      scoreLocked: true,
      status: "closed",
      evaluatedTasks: carryoverTasks.length,
      carryoverCreated: carryoverInserts.length,
      nextSprintId: nextSprint?.id || null,
      founderScores: scoreRows.length,
      strikeEvents: strikeEvents.length,
    },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    ok: true,
    sprint: { id, status: "closed", scoreLocked: true },
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
  });
}
