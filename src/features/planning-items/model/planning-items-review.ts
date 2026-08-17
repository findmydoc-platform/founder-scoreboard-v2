import "server-only";

import { createNotificationPayload } from "@/lib/notification-catalog";
import {
  isReviewReworkDecision,
  reviewChecklistScore,
  reviewDecisionLabels,
  reviewDecisionTaskState,
  reviewDecisionValidation,
} from "@/features/reviews/model/task-review-state";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type {
  ActOnItem,
  PlanningAction,
  PlanningError,
  PlanningItems,
  PlanningResult,
  PlanningReviewChecklist,
} from "./planning-items";
import type {
  PlanningCommitOutcome,
  PlanningCommitRequest,
  PlanningPreparation,
  PlanningPreparationRequest,
} from "./planning-items-store";

type ReviewAction = Extract<PlanningAction, {
  kind: "requestReview" | "decideReview" | "withdrawReview" | "reopenReview";
}>;

export type ReviewActionKind = ReviewAction["kind"];

export type ReviewTaskProjection = Readonly<{
  id: string;
  status: string;
  reviewStatus: string;
  reviewOwnerProfileId: string;
  reviewRequestedAt: string;
  scorePoints: number;
  scoreFinal: boolean;
  githubIssueSyncStatus: string;
  updatedAt: string;
  approvalStatus: string | null;
  approvalRevision: number;
  sprintId: string;
  scoreRelevant: boolean;
}>;

export type PlanningTaskReview = Readonly<{
  id: number;
  taskId: string;
  sprintId: string;
  reviewerProfileId: string;
  decision: "accepted" | "partial" | "changes_requested";
  points: number;
  comment: string;
  checklist: PlanningReviewChecklist;
  createdAt: string;
}>;

export type PlanningReviewActivity = Readonly<{
  id: number;
  taskId: string;
  message: string;
  createdAt: string;
}>;

type ReviewTaskState = Readonly<{
  id: string;
  kind: string;
  revision: string;
  title: string;
  status: string;
  approvalStatus: string;
  approvalRevision: number;
  assignee: string;
  owner: string;
  reviewStatus: string;
  reviewOwnerProfileId: string;
  reviewRequestedAt: string;
  scorePoints: number;
  scoreFinal: boolean;
  sprintId: string;
  scoreRelevant: boolean;
  githubIssueSyncStatus: string;
  trashed: boolean;
}>;

export type PlanningReviewState = Readonly<{
  task: ReviewTaskState | null;
  actorName: string;
  reviewerProfileId: string;
  reviewerContributor: boolean;
  defaultReviewerProfileId: string;
  defaultReviewerContributor: boolean;
  sprintLocked: boolean;
}>;

type NotificationPayload = ReturnType<typeof createNotificationPayload>;

export type PlanningReviewCommitPlan = Readonly<{
  action: "request" | "decide" | "withdraw" | "reopen";
  taskId: string;
  expectedRevision: string;
  reviewerProfileId: string;
  decision: "accepted" | "partial" | "changes_requested" | null;
  comment: string;
  checklist: PlanningReviewChecklist;
  points: number;
  reason: string;
  activityMessages: readonly string[];
  notifications: readonly NotificationPayload[];
  auditAfterData: Readonly<Record<string, unknown>>;
  originalTask: ReviewTaskProjection;
  projectedTask: ReviewTaskProjection;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type PlanningSupabase = Readonly<{
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult>;
}>;

const emptyChecklist: PlanningReviewChecklist = {
  acceptanceCriteriaMet: false,
  evidenceProvided: false,
  communicationClear: false,
  blockerHandled: false,
};

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function checklist(value: unknown): PlanningReviewChecklist {
  const row = record(value) || {};
  return {
    acceptanceCriteriaMet: Boolean(row.acceptanceCriteriaMet ?? row.dodMet),
    evidenceProvided: Boolean(row.evidenceProvided),
    communicationClear: Boolean(row.communicationClear),
    blockerHandled: Boolean(row.blockerHandled),
  };
}

export function isPlanningReviewRequestPayload(payload: unknown) {
  const row = record(payload);
  return Boolean(row && (row.status === "Review" || row.reviewStatus === "requested"));
}

export function parsePlanningReviewRequestPayload(payload: unknown):
  | Readonly<{ ok: true; value: { expectedUpdatedAt: string; reviewerProfileId: string } }>
  | Readonly<{ ok: false; error: string; status: number }> {
  const row = record(payload);
  if (!row || !validTimestamp(row.expectedUpdatedAt)) {
    return { ok: false, error: "Aktueller Aufgabenstand ist erforderlich.", status: 400 };
  }
  const supported = new Set(["expectedUpdatedAt", "status", "reviewStatus", "reviewOwnerProfileId", "scoreFinal"]);
  if (Object.keys(row).some((key) => !supported.has(key))) {
    return { ok: false, error: "Gib die Review-Anfrage getrennt von weiteren Änderungen ab.", status: 409 };
  }
  return {
    ok: true,
    value: {
      expectedUpdatedAt: row.expectedUpdatedAt,
      reviewerProfileId: text(row.reviewOwnerProfileId, 240),
    },
  };
}

export function parsePlanningReviewDecisionPayload(payload: unknown):
  | Readonly<{
    ok: true;
    value: {
      decision: "accepted" | "partial" | "changes_requested";
      comment: string;
      checklist: PlanningReviewChecklist;
    };
  }>
  | Readonly<{ ok: false; error: string }> {
  const row = record(payload);
  const decision = row?.decision;
  if (decision !== "accepted" && decision !== "partial" && decision !== "changes_requested") {
    return { ok: false, error: "Ungültige Review-Entscheidung." };
  }
  const normalizedChecklist = checklist(row?.checklist);
  const comment = text(row?.comment, 2_000);
  const validation = reviewDecisionValidation(decision, normalizedChecklist, comment);
  return validation.ok
    ? { ok: true, value: { decision, comment, checklist: normalizedChecklist } }
    : { ok: false, error: validation.message };
}

export function parsePlanningReviewWithdrawPayload(payload: unknown):
  | Readonly<{ ok: true; value: { expectedUpdatedAt: string; reason: string } }>
  | Readonly<{ ok: false; error: string }> {
  const row = record(payload);
  const reason = text(row?.reason, 2_000);
  if (reason.length < 2) return { ok: false, error: "Ein Grund für das Zurückziehen ist erforderlich." };
  if (!validTimestamp(row?.expectedUpdatedAt)) return { ok: false, error: "Aktueller Aufgabenstand ist erforderlich." };
  return { ok: true, value: { expectedUpdatedAt: row.expectedUpdatedAt, reason } };
}

export function parsePlanningReviewReopenPayload(payload: unknown):
  | Readonly<{ ok: true; value: { expectedUpdatedAt: string } }>
  | Readonly<{ ok: false; error: string }> {
  const row = record(payload);
  return validTimestamp(row?.expectedUpdatedAt)
    ? { ok: true, value: { expectedUpdatedAt: row.expectedUpdatedAt } }
    : { ok: false, error: "Aktueller Aufgabenstand ist erforderlich." };
}

export function requestPlanningReviewCommand(
  itemId: string,
  input: { expectedUpdatedAt: string; reviewerProfileId?: string },
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "requestReview",
      itemId,
      expectedRevision: input.expectedUpdatedAt,
      ...(input.reviewerProfileId ? { reviewerProfileId: input.reviewerProfileId } : {}),
    },
  };
}

export function decidePlanningReviewCommand(
  itemId: string,
  input: {
    decision: "accepted" | "partial" | "changes_requested";
    comment: string;
    checklist: PlanningReviewChecklist;
    expectedUpdatedAt?: string;
  },
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "decideReview",
      itemId,
      decision: input.decision,
      note: input.comment,
      checklist: input.checklist,
      ...(input.expectedUpdatedAt ? { expectedRevision: input.expectedUpdatedAt } : {}),
    },
  };
}

export function withdrawPlanningReviewCommand(itemId: string, expectedUpdatedAt: string, reason: string): ActOnItem {
  return {
    kind: "actOnItem",
    action: { kind: "withdrawReview", itemId, expectedRevision: expectedUpdatedAt, reason },
  };
}

export function reopenPlanningReviewCommand(itemId: string, expectedUpdatedAt: string): ActOnItem {
  return {
    kind: "actOnItem",
    action: { kind: "reopenReview", itemId, expectedRevision: expectedUpdatedAt },
  };
}

function reviewAction(command: ActOnItem): ReviewAction | null {
  return ["requestReview", "decideReview", "withdrawReview", "reopenReview"].includes(command.action.kind)
    ? command.action as ReviewAction
    : null;
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function conflict(reason: string): PlanningError {
  return { code: "conflict", reason: "state", details: { planningReviewReason: reason } };
}

function ownsTask(state: PlanningReviewState, profileId: string) {
  if (!state.task) return false;
  const identities = new Set([profileId, state.actorName].filter(Boolean));
  return identities.has(state.task.assignee) || identities.has(state.task.owner);
}

function canReview(state: PlanningReviewState, profileId: string, platformRole: string) {
  return platformRole === "ceo"
    || platformRole === "deputy"
    || state.task?.reviewOwnerProfileId === profileId;
}

function projectedTask(task: ReviewTaskState, overrides: Partial<ReviewTaskProjection>): ReviewTaskProjection {
  return {
    id: task.id,
    status: task.status,
    reviewStatus: task.reviewStatus,
    reviewOwnerProfileId: task.reviewOwnerProfileId,
    reviewRequestedAt: task.reviewRequestedAt,
    scorePoints: task.scorePoints,
    scoreFinal: task.scoreFinal,
    githubIssueSyncStatus: task.githubIssueSyncStatus,
    updatedAt: task.revision,
    approvalStatus: task.approvalStatus || null,
    approvalRevision: task.approvalRevision,
    sprintId: task.sprintId,
    scoreRelevant: task.scoreRelevant,
    ...overrides,
  };
}

function effects(notificationCount: number) {
  return [
    { kind: "activity" as const, description: "Record the review workflow activity" },
    ...(notificationCount ? [{ kind: "notification" as const, description: "Create review workflow notifications" }] : []),
    { kind: "audit" as const, description: "Record the review workflow audit event" },
    { kind: "githubProjection" as const, description: "Mark the GitHub projection stale" },
  ];
}

function taskChange(before: ReviewTaskProjection, after: ReviewTaskProjection) {
  return { field: "reviewTask", before, after } as const;
}

function decisionFor(action: ReviewAction, state: PlanningReviewState, actor: { profileId: string; platformRole: string }) {
  const task = state.task;
  if (!task) return { ok: false as const, error: { code: "notFound", entity: { kind: "deliverable", id: action.itemId } } as PlanningError };
  if (task.trashed) return { ok: false as const, error: conflict("trashed") };
  if (action.expectedRevision && action.expectedRevision !== task.revision) {
    return { ok: false as const, error: { code: "conflict", reason: "revision" } as PlanningError };
  }
  if (task.status === "Erledigt" && action.kind !== "reopenReview") {
    return { ok: false as const, error: conflict("completed") };
  }
  if (actor.platformRole === "viewer") {
    return { ok: false as const, error: { code: "forbidden", reason: "planningReviewRequiresContributor" } as PlanningError };
  }
  const operational = actor.platformRole === "ceo" || actor.platformRole === "deputy";
  const before = projectedTask(task, {});

  if (action.kind === "requestReview") {
    if (task.kind !== "deliverable" || task.approvalStatus !== "approved") return { ok: false as const, error: conflict("notApproved") };
    if (task.scoreFinal) return { ok: false as const, error: conflict("finalReview") };
    if (task.reviewStatus === "requested" || task.status === "Review") return { ok: false as const, error: conflict("activeReview") };
    if (!operational && !ownsTask(state, actor.profileId)) {
      return { ok: false as const, error: { code: "forbidden", reason: "planningReviewRequestForbidden" } as PlanningError };
    }
    if (state.sprintLocked) return { ok: false as const, error: conflict("sprintLocked") };
    const reviewerProfileId = actor.platformRole === "ceo" && action.reviewerProfileId
      ? state.reviewerProfileId
      : state.defaultReviewerProfileId;
    const reviewerContributor = actor.platformRole === "ceo" && action.reviewerProfileId
      ? state.reviewerContributor
      : state.defaultReviewerContributor;
    if (!reviewerProfileId) return { ok: false as const, error: conflict("reviewerRequired") };
    if (!reviewerContributor) return { ok: false as const, error: conflict("reviewerInvalid") };
    const notifications = [createNotificationPayload("task.review_requested", {
      actorProfileId: actor.profileId,
      recipientProfileId: reviewerProfileId,
      entityType: "task",
      entityId: task.id,
      title: `Review angefragt: ${task.title}`,
      body: "Diese Aufgabe wartet auf deine Accountable-Review.",
    })];
    const after = projectedTask(task, {
      status: "Review",
      reviewStatus: "requested",
      reviewOwnerProfileId: reviewerProfileId,
      reviewRequestedAt: "",
      scorePoints: 0,
      scoreFinal: false,
      githubIssueSyncStatus: "not_synced",
    });
    return {
      ok: true as const,
      before,
      after,
      plan: {
        action: "request" as const,
        taskId: task.id,
        expectedRevision: action.expectedRevision,
        reviewerProfileId,
        decision: null,
        comment: "",
        checklist: emptyChecklist,
        points: 0,
        reason: "",
        activityMessages: [
          ...(task.status === "Review" ? [] : [`Status geändert: ${task.status} → Review`]),
          ...(task.reviewStatus === "requested" ? [] : [`Review geändert: ${task.reviewStatus} → requested`]),
        ],
        notifications,
        auditAfterData: { status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: reviewerProfileId },
        originalTask: before,
        projectedTask: after,
      },
    };
  }

  if (action.kind === "decideReview") {
    if (task.kind !== "deliverable" || task.approvalStatus !== "approved") return { ok: false as const, error: conflict("notApproved") };
    if (task.reviewStatus !== "requested" || task.status !== "Review" || task.scoreFinal) return { ok: false as const, error: conflict("notActive") };
    if (!canReview(state, actor.profileId, actor.platformRole)) {
      return { ok: false as const, error: { code: "forbidden", reason: "planningReviewDecisionForbidden" } as PlanningError };
    }
    if (state.sprintLocked) return { ok: false as const, error: conflict("sprintLocked") };
    const validation = reviewDecisionValidation(action.decision, action.checklist, action.note);
    if (!validation.ok) return { ok: false as const, error: invalid(validation.message) };
    const points = action.decision === "accepted" || action.decision === "partial"
      ? reviewChecklistScore(action.checklist)
      : 0;
    const next = reviewDecisionTaskState(action.decision);
    const rework = isReviewReworkDecision(action.decision);
    const assignee = task.assignee || task.owner;
    const notifications = assignee && assignee !== actor.profileId
      ? [createNotificationPayload(rework ? "task.review_rework" : "task.review_completed", {
        actorProfileId: actor.profileId,
        recipientProfileId: assignee,
        entityType: "task",
        entityId: task.id,
        title: rework ? `${reviewDecisionLabels[action.decision]}: ${task.title}` : `Review abgeschlossen: ${task.title}`,
        body: action.note || `${points} Punkte · ${action.decision}`,
      })]
      : [];
    const after = projectedTask(task, {
      status: next.status,
      reviewStatus: action.decision,
      reviewRequestedAt: "",
      scorePoints: points,
      scoreFinal: next.scoreFinal,
      githubIssueSyncStatus: "not_synced",
    });
    return {
      ok: true as const,
      before,
      after,
      plan: {
        action: "decide" as const,
        taskId: task.id,
        expectedRevision: action.expectedRevision || task.revision,
        reviewerProfileId: actor.profileId,
        decision: action.decision,
        comment: action.note,
        checklist: action.checklist,
        points,
        reason: "",
        activityMessages: [rework
          ? `${reviewDecisionLabels[action.decision]} angefordert: ${action.note || "ohne Kommentar"}`
          : `Review finalisiert: ${reviewDecisionLabels[action.decision]}, ${points} Punkte`],
        notifications,
        auditAfterData: { decision: action.decision, points, status: next.status, scoreFinal: next.scoreFinal, checklist: action.checklist },
        originalTask: before,
        projectedTask: after,
      },
    };
  }

  if (action.kind === "withdrawReview") {
    if (task.reviewStatus !== "requested" || task.scoreFinal) return { ok: false as const, error: conflict("notActive") };
    if (!operational && !ownsTask(state, actor.profileId)) {
      return { ok: false as const, error: { code: "forbidden", reason: "planningReviewWithdrawForbidden" } as PlanningError };
    }
    if (action.reason.trim().length < 2) return { ok: false as const, error: invalid("withdrawReasonRequired") };
    const notifications = task.reviewOwnerProfileId && task.reviewOwnerProfileId !== actor.profileId
      ? [createNotificationPayload("task.review_withdrawn", {
        actorProfileId: actor.profileId,
        recipientProfileId: task.reviewOwnerProfileId,
        entityType: "task",
        entityId: task.id,
        title: `Review zurückgezogen: ${task.title}`,
        body: action.reason,
      })]
      : [];
    const after = projectedTask(task, {
      status: "In Arbeit",
      reviewStatus: "not_requested",
      reviewRequestedAt: "",
      scorePoints: 0,
      scoreFinal: false,
      githubIssueSyncStatus: "not_synced",
    });
    return {
      ok: true as const,
      before,
      after,
      plan: {
        action: "withdraw" as const,
        taskId: task.id,
        expectedRevision: action.expectedRevision,
        reviewerProfileId: task.reviewOwnerProfileId,
        decision: null,
        comment: "",
        checklist: emptyChecklist,
        points: 0,
        reason: action.reason,
        activityMessages: [`Review zurückgezogen: ${action.reason}`],
        notifications,
        auditAfterData: { status: "In Arbeit", reviewStatus: "not_requested", scoreFinal: false, reason: action.reason },
        originalTask: before,
        projectedTask: after,
      },
    };
  }

  if (task.kind !== "deliverable" || task.approvalStatus !== "approved") return { ok: false as const, error: conflict("notApproved") };
  if (!task.scoreFinal || task.reviewStatus !== "accepted") return { ok: false as const, error: conflict("notFinal") };
  if (!task.reviewOwnerProfileId) return { ok: false as const, error: conflict("reviewerRequired") };
  if (!state.reviewerContributor) return { ok: false as const, error: conflict("reviewerInvalid") };
  if (!canReview(state, actor.profileId, actor.platformRole)) {
    return { ok: false as const, error: { code: "forbidden", reason: "planningReviewReopenForbidden" } as PlanningError };
  }
  if (state.sprintLocked) return { ok: false as const, error: conflict("sprintLocked") };
  const assignee = task.assignee || task.owner;
  const notifications = [createNotificationPayload("task.review_requested", {
    actorProfileId: actor.profileId,
    recipientProfileId: task.reviewOwnerProfileId,
    entityType: "task",
    entityId: task.id,
    title: `Review wieder geöffnet: ${task.title}`,
    body: "Diese Aufgabe wartet erneut auf Review.",
  })];
  if (assignee && assignee !== task.reviewOwnerProfileId) {
    notifications.push(createNotificationPayload("task.review_reopened", {
      actorProfileId: actor.profileId,
      recipientProfileId: assignee,
      entityType: "task",
      entityId: task.id,
      title: `Review wieder geöffnet: ${task.title}`,
      body: "Die Aufgabe wurde zur erneuten Review geöffnet.",
    }));
  }
  const after = projectedTask(task, {
    status: "Review",
    reviewStatus: "requested",
    reviewRequestedAt: "",
    scorePoints: 0,
    scoreFinal: false,
    githubIssueSyncStatus: "not_synced",
  });
  return {
    ok: true as const,
    before,
    after,
    plan: {
      action: "reopen" as const,
      taskId: task.id,
      expectedRevision: action.expectedRevision,
      reviewerProfileId: task.reviewOwnerProfileId,
      decision: null,
      comment: "",
      checklist: emptyChecklist,
      points: 0,
      reason: "",
      activityMessages: ["Review wieder geöffnet"],
      notifications,
      auditAfterData: { status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: task.reviewOwnerProfileId },
      originalTask: before,
      projectedTask: after,
    },
  };
}

export const planningReviewDecisionCore: PlanningDecisionCore<PlanningReviewState, PlanningReviewCommitPlan> = {
  decide({ actor, command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("planningReviewActionRequired") };
    const action = reviewAction(command);
    if (!action) return { ok: false, error: invalid("planningReviewActionRequired") };
    const decision = decisionFor(action, state, actor);
    if (!decision.ok) return { ok: false, error: decision.error };
    return {
      ok: true,
      items: [],
      changes: [taskChange(decision.before, decision.after)],
      effects: effects(decision.plan.notifications.length),
      warnings: [],
      commitPlan: decision.plan,
    };
  },
};

function taskState(value: unknown): ReviewTaskState | null {
  const row = record(value);
  if (!row || typeof row.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    kind: String(row.task_type || ""),
    revision: String(row.updated_at || ""),
    title: String(row.title || ""),
    status: String(row.status || ""),
    approvalStatus: String(row.approval_status || ""),
    approvalRevision: Number(row.approval_revision || 1),
    assignee: String(row.assignee || ""),
    owner: String(row.owner || ""),
    reviewStatus: String(row.review_status || "not_requested"),
    reviewOwnerProfileId: String(row.review_owner_profile_id || ""),
    reviewRequestedAt: String(row.review_requested_at || ""),
    scorePoints: Number(row.score_points || 0),
    scoreFinal: Boolean(row.score_final),
    sprintId: String(row.sprint_id || ""),
    scoreRelevant: Boolean(row.score_relevant),
    githubIssueSyncStatus: String(row.github_issue_sync_status || "not_synced"),
    trashed: Boolean(row.trashed_at),
  };
}

function preparationState(value: unknown): PlanningReviewState | null {
  const row = record(value);
  if (!row) return null;
  const reviewer = record(row.reviewer);
  const defaultReviewer = record(row.defaultReviewer);
  return {
    task: taskState(row.task),
    actorName: String(row.actorName || ""),
    reviewerProfileId: String(reviewer?.id || ""),
    reviewerContributor: Boolean(reviewer?.contributor),
    defaultReviewerProfileId: String(defaultReviewer?.id || ""),
    defaultReviewerContributor: Boolean(defaultReviewer?.contributor),
    sprintLocked: Boolean(row.sprintLocked),
  };
}

async function prepareReview(
  supabase: PlanningSupabase,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<PlanningReviewState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") {
    return { data: { kind: "error", error: invalid("planningReviewActionRequired") }, error: null };
  }
  const action = reviewAction(request.command);
  if (!action) return { data: { kind: "error", error: invalid("planningReviewActionRequired") }, error: null };
  const result = await supabase.rpc("prepare_planning_review_command", {
    p_task_id: action.itemId,
    p_requested_reviewer_profile_id: action.kind === "requestReview" ? action.reviewerProfileId || null : null,
    p_actor_profile_id: request.actor.profileId,
  });
  if (result.error) return { data: null, error: result.error };
  const state = preparationState(result.data);
  return state
    ? { data: { kind: "state", state }, error: null }
    : { data: null, error: new Error("Invalid planning review state") };
}

function providerError(code: string, request: PlanningCommitRequest<PlanningReviewCommitPlan>): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: request.plan.taskId } } };
  if (code === "P0003") return { ok: false, error: conflict("sprintLocked") };
  if (code === "P0004") return { ok: false, error: conflict(request.plan.action === "reopen" ? "notFinal" : "notActive") };
  if (code === "P0005" || code === "P0006") return { ok: false, error: { code: "forbidden", reason: "planningReviewAuthorizationChanged" } };
  if (code === "P0007") return { ok: false, error: conflict("reviewerInvalid") };
  if (code === "P0010") return { ok: false, error: conflict("trashed") };
  if (code === "P0016") return { ok: false, error: conflict("completed") };
  if (code === "22023" || code === "23514") return { ok: false, error: invalid("invalidPlanningReview") };
  return null;
}

function taskProjection(value: unknown): ReviewTaskProjection | null {
  const state = taskState(value);
  return state ? projectedTask(state, {}) : null;
}

function taskReview(value: unknown): PlanningTaskReview | null {
  const row = record(value);
  const decision = row?.decision;
  const id = Number(row?.id);
  if (!row || !Number.isInteger(id) || id <= 0 || (decision !== "accepted" && decision !== "partial" && decision !== "changes_requested")) return null;
  return {
    id,
    taskId: String(row.task_id || ""),
    sprintId: String(row.sprint_id || ""),
    reviewerProfileId: String(row.reviewer_profile_id || ""),
    decision,
    points: Number(row.points || 0),
    comment: String(row.comment || ""),
    checklist: checklist(row.checklist),
    createdAt: String(row.created_at || ""),
  };
}

function activities(value: unknown): readonly PlanningReviewActivity[] {
  return Array.isArray(value) ? value.flatMap((candidate) => {
    const row = record(candidate);
    const id = Number(row?.id);
    return row && Number.isInteger(id) && id > 0 ? [{
      id,
      taskId: String(row.task_id || ""),
      message: String(row.message || ""),
      createdAt: String(row.created_at || ""),
    }] : [];
  }) : [];
}

async function commitReview(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<PlanningReviewCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const result = await supabase.rpc("mutate_planning_review_command_transaction", {
    p_action: request.plan.action,
    p_task_id: request.plan.taskId,
    p_expected_updated_at: request.plan.expectedRevision,
    p_actor_profile_id: request.actor.profileId,
    p_reviewer_profile_id: request.plan.reviewerProfileId || null,
    p_decision: request.plan.decision,
    p_comment: request.plan.comment || null,
    p_checklist: request.plan.checklist,
    p_points: request.plan.points,
    p_reason: request.plan.reason || null,
    p_activity_messages: request.plan.activityMessages,
    p_notifications: request.plan.notifications,
    p_audit_after_data: request.plan.auditAfterData,
    p_request_ip: request.requestMetadata?.requestIp || null,
    p_user_agent: request.requestMetadata?.userAgent || null,
  });
  if (result.error) {
    const mapped = providerError(String((result.error as { code?: unknown }).code || ""), request);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const transaction = record(result.data);
  const committedTask = taskProjection(transaction?.task);
  if (!transaction || !committedTask) return { data: null, error: new Error("Planning review result is incomplete") };
  const committedReview = taskReview(transaction.review);
  const committedActivities = activities(transaction.activities);
  const appliedEffects = effects(request.plan.notifications.length).map((effect) => ({ ...effect, status: "applied" as const }));
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [
          taskChange(request.plan.originalTask, committedTask),
          ...(committedReview ? [{ field: "taskReview", before: null, after: committedReview }] : []),
          { field: "reviewActivities", before: [], after: committedActivities },
        ],
        effects: appliedEffects,
        replayed: false,
      },
    },
    error: null,
  };
}

export function createPlanningReviewPlanningItems(supabaseClient: unknown): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<PlanningReviewState, PlanningReviewCommitPlan>({
      prepareCommand: (request) => prepareReview(supabase, request),
      commitCommand: (request) => commitReview(supabase, request),
    }),
    decisionCore: planningReviewDecisionCore,
  });
}

export function planningReviewTaskFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "reviewTask");
  return record(change?.after) as ReviewTaskProjection | null;
}

export function planningTaskReviewFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "taskReview");
  return change ? taskReview(change.after) : null;
}

export function planningReviewActivitiesFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "reviewActivities");
  return activities(change?.after);
}

export function planningReviewError(error: PlanningError, action: "request" | "decide" | "withdraw" | "reopen") {
  if (error.code === "invalidCommand") {
    const message = error.issues[0]?.reason || "";
    if (message === "withdrawReasonRequired") return { message: "Ein Grund für das Zurückziehen ist erforderlich.", status: 400 };
    if (message && message !== "invalidPlanningReview") return { message, status: 400 };
    return { message: "Review-Daten sind ungültig.", status: 400 };
  }
  if (error.code === "notFound") return { message: "Aufgabe wurde nicht gefunden.", status: 404 };
  if (error.code === "forbidden") {
    if (action === "withdraw") return { message: "Nur die Zuständigkeit, CEO oder Deputy können dieses Review zurückziehen.", status: 403 };
    if (action === "request") return { message: "Founder können nur den Status ihrer eigenen Aufgaben ändern.", status: 403 };
    return { message: "Nur Review Owner, CEO oder Deputy können diese Review finalisieren.", status: 403 };
  }
  if (error.code === "conflict" && error.reason === "revision") {
    return { message: action === "request" ? "Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden." : "Aufgabe wurde parallel geändert. Bitte neu laden.", status: 409 };
  }
  if (error.code === "conflict") {
    const reason = String(error.details?.planningReviewReason || "");
    if (reason === "trashed") return { message: "Aufgabe befindet sich im Papierkorb und kann nicht geändert werden.", status: 409 };
    if (reason === "completed") return { message: "Dieses Issue ist nach dem Schließen geschützt. Öffne es wieder, bevor du das Review änderst.", status: 409 };
    if (reason === "sprintLocked") return { message: "Sprint-Score ist bereits gelockt.", status: 409 };
    if (reason === "reviewerRequired") return { message: action === "reopen" ? "Lege vor dem erneuten Review eine Review-Verantwortung fest." : "Lege vor der Review-Anfrage eine Review-Verantwortung fest.", status: 409 };
    if (reason === "reviewerInvalid") return { message: "Die Review-Verantwortung braucht eine beitragende Rolle.", status: 409 };
    if (reason === "finalReview") return { message: "Final bewertete Aufgaben müssen über „Review erneut öffnen“ zurück in Review gegeben werden.", status: 409 };
    if (reason === "notFinal") return { message: "Nur ein final akzeptiertes Review kann erneut geöffnet werden.", status: 409 };
    if (reason === "notActive" || reason === "activeReview") {
      if (action === "withdraw") return { message: "Dieses Review ist nicht mehr aktiv.", status: 409 };
      if (action === "reopen") return { message: "Dieses Review kann nicht erneut geöffnet werden.", status: 409 };
      return { message: "Diese Aufgabe befindet sich nicht in einem aktiven Review.", status: 409 };
    }
    if (reason === "notApproved") {
      if (action === "request") return { message: "Nur freigegebene Deliverables können in Review gegeben werden.", status: 409 };
      if (action === "reopen") return { message: "Nur freigegebene Deliverables können erneut in Review gegeben werden.", status: 409 };
      return { message: "Nur freigegebene Deliverables können reviewed werden.", status: 409 };
    }
  }
  const fallback = action === "withdraw"
    ? "Review konnte nicht zurückgezogen werden."
    : action === "reopen"
      ? "Review konnte nicht vollständig wieder geöffnet werden."
      : action === "decide"
        ? "Review konnte nicht vollständig gespeichert werden."
        : "Aufgabe konnte nicht gespeichert werden.";
  return { message: fallback, status: 500 };
}
