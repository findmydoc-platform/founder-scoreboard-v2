import { taskOwnedByProfile, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { taskStatuses } from "@/lib/status";
import type { AuthenticatedProfile } from "@/lib/types";

export type TaskRouteDbUpdate = Record<string, string | number | boolean | null>;

type CurrentTaskForRoute = {
  owner?: string | null;
  status?: string | null;
  task_type?: string | null;
};

type RouteGuardResult = { ok: true } | { ok: false; error: string; status: number };

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const reviewStatuses = new Set(["not_requested", "requested", "accepted", "partial", "changes_requested"]);
const syncStatuses = new Set(["not_synced", "synced", "pending", "failed"]);

export function restrictedTaskUpdateFields(payload: TaskUpdatePayload) {
  const isImplicitReviewScoreReset = startsTaskReviewRequest(payload) && payload.scoreFinal === false && payload.scorePoints === undefined;

  return [
    payload.owner !== undefined ? "Owner" : "",
    payload.priority !== undefined ? "Priorität" : "",
    payload.packageId !== undefined ? "Initiative" : "",
    payload.sprintId !== undefined ? "Sprint" : "",
    payload.milestoneId !== undefined ? "Epic / Meilenstein" : "",
    payload.startDate !== undefined || payload.endDate !== undefined || payload.deadline !== undefined ? "Zeitraum" : "",
    payload.scorePoints !== undefined || (payload.scoreFinal !== undefined && !isImplicitReviewScoreReset) ? "Score" : "",
  ].filter(Boolean);
}

export function validateTaskStatusUpdate({
  currentTask,
  isOperationalLead,
  payload,
  profile,
}: {
  currentTask: CurrentTaskForRoute;
  isOperationalLead: boolean;
  payload: TaskUpdatePayload;
  profile?: AuthenticatedProfile | null;
}): RouteGuardResult {
  if (!payload.status) return { ok: true };
  if (!taskStatuses.includes(payload.status as (typeof taskStatuses)[number])) {
    return { ok: false, error: "Ungültiger Status.", status: 400 };
  }
  if (!isOperationalLead && !taskOwnedByProfile(currentTask, profile)) {
    return { ok: false, error: "Founder können nur den Status ihrer eigenen Aufgaben ändern.", status: 403 };
  }
  if (!isOperationalLead && payload.status === "Erledigt") {
    return { ok: false, error: "Founder können Aufgaben nur in Review geben. Final erledigt wird im CEO-Review gesetzt.", status: 403 };
  }
  if (!isOperationalLead && currentTask.status === "Nacharbeit" && !["In Arbeit", "Review", "Blockiert"].includes(payload.status)) {
    return { ok: false, error: "Nacharbeit kann nur wieder bearbeitet, blockiert oder erneut in Review gegeben werden.", status: 403 };
  }
  return { ok: true };
}

export function applyTaskStatusUpdate(update: TaskRouteDbUpdate, payload: TaskUpdatePayload) {
  if (payload.status) update.status = payload.status;
}

export function applyTaskPriorityUpdate(update: TaskRouteDbUpdate, payload: TaskUpdatePayload): RouteGuardResult {
  if (!payload.priority) return { ok: true };
  if (!priorities.has(payload.priority)) {
    return { ok: false, error: "Ungültige Priorität.", status: 400 };
  }
  update.priority = payload.priority;
  return { ok: true };
}

export function applyTaskBriefUpdateFields(update: TaskRouteDbUpdate, payload: TaskUpdatePayload) {
  if (payload.startDate !== undefined) update.start_date = payload.startDate || null;
  if (payload.endDate !== undefined) update.end_date = payload.endDate || null;
  if (payload.deadline !== undefined) update.deadline = payload.deadline || null;
  if (payload.problemStatement !== undefined) update.problem_statement = payload.problemStatement.trim().slice(0, 4000) || null;
  if (payload.intendedOutcome !== undefined) update.intended_outcome = payload.intendedOutcome.trim().slice(0, 4000) || null;
  if (payload.scopeConstraints !== undefined) update.scope_constraints = payload.scopeConstraints.trim().slice(0, 4000) || null;
  if (payload.acceptanceCriteria !== undefined) update.acceptance_criteria = payload.acceptanceCriteria.trim().slice(0, 6000) || null;
  if (payload.evidenceRequired !== undefined) update.evidence_required = payload.evidenceRequired.trim().slice(0, 4000) || null;
  if (payload.definitionOfDone !== undefined) update.definition_of_done = payload.definitionOfDone.trim().slice(0, 4000) || null;
  if (payload.evidenceLink !== undefined) update.evidence_link = payload.evidenceLink.trim().slice(0, 4000) || null;
}

export function proposalPromotionState(currentTask: {
  task_type?: string | null;
  owner?: string | null;
  status?: string | null;
  package_id?: string | null;
  sprint_id?: string | null;
}, update: TaskRouteDbUpdate) {
  const effectiveOwner = typeof update.owner === "string" ? update.owner : currentTask.owner || "";
  const effectiveStatus = typeof update.status === "string" ? update.status : currentTask.status || "";
  const effectivePackageId = typeof update.package_id === "string" ? update.package_id : currentTask.package_id || "";
  const effectiveSprintId = typeof update.sprint_id === "string" ? update.sprint_id : currentTask.sprint_id || "";
  const shouldPromoteProposal =
    currentTask.task_type === "proposal" &&
    Boolean(effectiveOwner) &&
    effectiveStatus !== "Vorschlag";

  return { effectivePackageId, effectiveSprintId, shouldPromoteProposal };
}

export function applyReviewStatusUpdate(update: TaskRouteDbUpdate, payload: TaskUpdatePayload, isOperationalLead: boolean): RouteGuardResult {
  if (!payload.reviewStatus) return { ok: true };
  if (!reviewStatuses.has(payload.reviewStatus)) {
    return { ok: false, error: "Ungültiger Review-Status.", status: 400 };
  }
  if (!isOperationalLead && payload.reviewStatus !== "requested") {
    return { ok: false, error: "Founder können Review nur anfragen. Final bewertet wird im CEO-Review.", status: 403 };
  }
  update.review_status = payload.reviewStatus;
  update.score_final = ["accepted", "partial", "changes_requested"].includes(payload.reviewStatus);
  if (!isOperationalLead) update.score_final = false;
  return { ok: true };
}

export function applyTaskScoreUpdateFields(update: TaskRouteDbUpdate, payload: TaskUpdatePayload) {
  if (payload.scorePoints !== undefined) update.score_points = Math.max(0, payload.scorePoints);
  if (payload.scoreFinal !== undefined) update.score_final = Boolean(payload.scoreFinal);
}

export function startsTaskReviewRequest(payload: TaskUpdatePayload) {
  return payload.status === "Review" || payload.reviewStatus === "requested";
}

export function applyTaskSyncStatusUpdate(update: TaskRouteDbUpdate, payload: TaskUpdatePayload): RouteGuardResult {
  if (!payload.githubSyncStatus) return { ok: true };
  if (!syncStatuses.has(payload.githubSyncStatus)) {
    return { ok: false, error: "Ungültiger GitHub-Sync-Status.", status: 400 };
  }
  update.github_sync_status = payload.githubSyncStatus;
  return { ok: true };
}

export function applyTaskSelfChecklistUpdateFields(update: TaskRouteDbUpdate, payload: TaskUpdatePayload) {
  if (payload.selfDodChecked !== undefined) update.self_dod_checked = Boolean(payload.selfDodChecked);
  if (payload.selfEvidenceChecked !== undefined) update.self_evidence_checked = Boolean(payload.selfEvidenceChecked);
  if (payload.selfDocumentedChecked !== undefined) update.self_documented_checked = Boolean(payload.selfDocumentedChecked);
  if (payload.selfBlockersChecked !== undefined) update.self_blockers_checked = Boolean(payload.selfBlockersChecked);
}

export function markTaskGitHubSyncDirty(update: TaskRouteDbUpdate, payload: TaskUpdatePayload) {
  if (Object.keys(update).length && payload.githubSyncStatus === undefined) {
    update.github_sync_status = "not_synced";
    update.github_sync_error = null;
  }
}
