import { reviewOwnerForTask, taskAssigneePatch } from "@/features/planning/model/planning-app-model";
import { slugify } from "@/lib/slug";
import type { Package, Profile, Task } from "@/lib/types";

export type TaskUpdatePayload = {
  expectedUpdatedAt?: string;
  title?: string;
  status?: string;
  assignee?: string;
  owner?: string;
  reviewOwnerProfileId?: string;
  priority?: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  definitionOfDone?: string;
  packageId?: string;
  milestoneId?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  dependsOn?: string;
  evidenceLink?: string;
  note?: string;
  reviewStatus?: string;
  scorePoints?: number;
  scoreFinal?: boolean;
  githubIssueSyncStatus?: string;
  sprintId?: string;
  parentTaskId?: string;
  selfDodChecked?: boolean;
  selfEvidenceChecked?: boolean;
  selfDocumentedChecked?: boolean;
  selfBlockersChecked?: boolean;
};

export type CurrentTaskForActivity = {
  title?: string | null;
  task_type?: string | null;
  status?: string | null;
  review_status?: string | null;
  review_owner_profile_id?: string | null;
  review_requested_at?: string | null;
  score_final?: boolean | null;
  assignee?: string | null;
  owner?: string | null;
  priority?: string | null;
  sprint_id?: string | null;
  milestone_id?: string | null;
  package_id?: string | null;
  parent_task_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  deadline?: string | null;
  evidence_link?: string | null;
};

type DbTaskUpdate = Record<string, string | number | boolean | null>;

type NormalizedClientTaskPatch =
  | { ok: true; patch: Partial<Task> }
  | { ok: false; error: string };

export function profileId(value?: string) {
  return slugify(value || "");
}

export function taskAssignedToProfile(task: { assignee?: string | null; owner?: string | null }, profile?: { id?: string; name?: string } | null) {
  const assignee = task.assignee || task.owner || "";
  if (!profile || !assignee) return false;
  return assignee === profile.id || assignee === profile.name || assignee === profileId(profile.name);
}

export function buildClientTaskUpdatePatch(
  task: Task,
  patch: Partial<Task>,
  profiles: Profile[],
  packages: Package[],
  reviewRequestedAt = new Date().toISOString(),
): NormalizedClientTaskPatch {
  let normalizedPatch = patch.assignee !== undefined || patch.assigneeId !== undefined || patch.owner !== undefined || patch.ownerId !== undefined
    ? { ...patch, ...taskAssigneePatch(patch.assigneeId || patch.assignee || patch.ownerId || patch.owner || "", profiles) }
    : patch;

  if (normalizedPatch.status === "Review" || normalizedPatch.reviewStatus === "requested") {
    if (task.scoreFinal) {
      return { ok: false, error: "Final bewertete Aufgaben können nicht erneut in Review gegeben werden." };
    }
    const nextTask = { ...task, ...normalizedPatch };
    normalizedPatch = {
      ...normalizedPatch,
      status: "Review",
      reviewStatus: "requested",
      scoreFinal: false,
      reviewOwnerProfileId: reviewOwnerForTask(nextTask, packages),
      reviewRequestedAt,
    };
  }

  return { ok: true, patch: normalizedPatch };
}

export function taskUpdateRequestPayload(patch: Partial<Task>, expectedUpdatedAt: string): TaskUpdatePayload {
  const isReviewRequest = patch.status === "Review" || patch.reviewStatus === "requested";

  return {
    expectedUpdatedAt,
    title: patch.title,
    status: patch.status,
    assignee: patch.assigneeId || patch.assignee || patch.ownerId || patch.owner,
    priority: patch.priority,
    problemStatement: patch.problemStatement,
    intendedOutcome: patch.intendedOutcome,
    scopeConstraints: patch.scopeConstraints,
    acceptanceCriteria: patch.acceptanceCriteria,
    evidenceRequired: patch.evidenceRequired,
    definitionOfDone: patch.definitionOfDone,
    packageId: patch.parentTaskId !== undefined ? undefined : patch.packageId,
    startDate: patch.startDate,
    endDate: patch.endDate,
    deadline: patch.deadline,
    note: patch.note,
    reviewStatus: patch.reviewStatus,
    reviewOwnerProfileId: isReviewRequest ? undefined : patch.reviewOwnerProfileId,
    scorePoints: patch.scorePoints,
    scoreFinal: isReviewRequest ? undefined : patch.scoreFinal,
    githubIssueSyncStatus: patch.githubIssueSyncStatus,
    sprintId: patch.sprintId,
    parentTaskId: patch.parentTaskId,
    milestoneId: patch.parentTaskId !== undefined ? undefined : patch.milestoneId,
    dependsOn: patch.dependsOn,
    evidenceLink: patch.evidenceLink,
    selfDodChecked: patch.selfDodChecked,
    selfEvidenceChecked: patch.selfEvidenceChecked,
    selfDocumentedChecked: patch.selfDocumentedChecked,
    selfBlockersChecked: patch.selfBlockersChecked,
  };
}

function formatChange(previous?: string | number | boolean | null, next?: string | number | boolean | null) {
  const before = previous === undefined || previous === null || previous === "" ? "leer" : String(previous);
  const after = next === undefined || next === null || next === "" ? "leer" : String(next);
  return `${before} → ${after}`;
}

export function activityMessages(payload: TaskUpdatePayload, currentTask?: CurrentTaskForActivity | null) {
  const messages: string[] = [];
  if (payload.title !== undefined && payload.title !== currentTask?.title) {
    messages.push(`Titel geändert: ${formatChange(currentTask?.title, payload.title)}`);
  }
  if (payload.status && currentTask?.status && payload.status !== currentTask.status) {
    messages.push(`Status geändert: ${currentTask.status} → ${payload.status}`);
  }
  if (payload.reviewStatus && currentTask?.review_status && payload.reviewStatus !== currentTask.review_status) {
    messages.push(`Review geändert: ${currentTask.review_status} → ${payload.reviewStatus}`);
  }
  if (payload.reviewOwnerProfileId !== undefined && payload.reviewOwnerProfileId !== currentTask?.review_owner_profile_id) {
    messages.push(`Review Owner geändert: ${formatChange(currentTask?.review_owner_profile_id, payload.reviewOwnerProfileId)}`);
  }
  if (payload.assignee !== undefined && payload.assignee !== (currentTask?.assignee || currentTask?.owner)) messages.push(`Zuständigkeit geändert: ${formatChange(currentTask?.assignee || currentTask?.owner, payload.assignee)}`);
  if (payload.priority !== undefined && payload.priority !== currentTask?.priority) messages.push(`Priorität geändert: ${formatChange(currentTask?.priority, payload.priority)}`);
  if (payload.sprintId !== undefined && payload.sprintId !== currentTask?.sprint_id) messages.push(`Sprint-Zuordnung geändert: ${formatChange(currentTask?.sprint_id, payload.sprintId)}`);
  if (payload.milestoneId !== undefined && payload.milestoneId !== currentTask?.milestone_id) messages.push(`Epic / Meilenstein geändert: ${formatChange(currentTask?.milestone_id, payload.milestoneId)}`);
  if (payload.packageId !== undefined && payload.packageId !== currentTask?.package_id) messages.push(`Initiative geändert: ${formatChange(currentTask?.package_id, payload.packageId)}`);
  if (payload.parentTaskId !== undefined && payload.parentTaskId !== currentTask?.parent_task_id) {
    messages.push(`Parent-Deliverable geändert: ${formatChange(currentTask?.parent_task_id, payload.parentTaskId)}`);
  }
  if (
    (payload.startDate !== undefined && payload.startDate !== currentTask?.start_date)
    || (payload.endDate !== undefined && payload.endDate !== currentTask?.end_date)
    || (payload.deadline !== undefined && payload.deadline !== currentTask?.deadline)
  ) {
    messages.push(`Zeitraum geändert: ${formatChange(currentTask?.start_date, payload.startDate ?? currentTask?.start_date)} bis ${formatChange(currentTask?.end_date, payload.endDate ?? currentTask?.end_date)}`);
  }
  if (payload.problemStatement !== undefined || payload.intendedOutcome !== undefined || payload.scopeConstraints !== undefined || payload.acceptanceCriteria !== undefined || payload.evidenceRequired !== undefined || payload.definitionOfDone !== undefined) messages.push("Aufgabenbrief aktualisiert");
  if (payload.evidenceLink !== undefined && payload.evidenceLink !== currentTask?.evidence_link) messages.push("Evidence-Link geändert");
  if (payload.selfDodChecked !== undefined || payload.selfEvidenceChecked !== undefined || payload.selfDocumentedChecked !== undefined || payload.selfBlockersChecked !== undefined) messages.push("Founder-Checkliste aktualisiert");
  if (payload.note !== undefined) messages.push("Notiz aktualisiert");
  if (payload.dependsOn !== undefined) messages.push("Abhängigkeit aktualisiert");
  return [...new Set(messages)];
}

export function buildTaskUpdateResponsePatch(
  id: string,
  update: DbTaskUpdate,
  startsReviewRequest: boolean,
): (Partial<Task> & { id: string }) | undefined {
  if (startsReviewRequest || update.review_owner_profile_id !== undefined) {
    return {
      id,
      ...(update.assignee ? { assigneeId: String(update.assignee), assignee: String(update.assignee) } : {}),
      ...(update.owner ? { ownerId: String(update.owner), owner: String(update.owner) } : {}),
      ...(update.title ? { title: String(update.title) } : {}),
      ...(update.status ? { status: String(update.status) } : {}),
      ...(update.review_status ? { reviewStatus: String(update.review_status) as Task["reviewStatus"] } : {}),
      ...(update.score_final !== undefined ? { scoreFinal: Boolean(update.score_final) } : {}),
      reviewOwnerProfileId: typeof update.review_owner_profile_id === "string" ? update.review_owner_profile_id : "",
      ...(update.review_requested_at ? { reviewRequestedAt: String(update.review_requested_at) } : {}),
      ...(update.task_type ? { taskType: String(update.task_type) as Task["taskType"] } : {}),
      ...(update.score_relevant !== undefined ? { scoreRelevant: Boolean(update.score_relevant) } : {}),
    };
  }

  if (Object.keys(update).length) {
    return {
      id,
      ...(update.assignee ? { assigneeId: String(update.assignee), assignee: String(update.assignee) } : {}),
      ...(update.owner ? { ownerId: String(update.owner), owner: String(update.owner) } : {}),
      ...(update.title ? { title: String(update.title) } : {}),
      ...(update.task_type ? { taskType: String(update.task_type) as Task["taskType"] } : {}),
      ...(update.score_relevant !== undefined ? { scoreRelevant: Boolean(update.score_relevant) } : {}),
    };
  }

  return undefined;
}
