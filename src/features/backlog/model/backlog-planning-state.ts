import { normalizeStatus } from "@/lib/status";
import type { Sprint, Task } from "@/lib/types";

export type BacklogPlanningStateKind = "ready" | "scheduled" | "blocked" | "completed" | "unsupported";
export type BacklogPlanningBlockingReason = "approval" | "owner" | "initiative";

export type BacklogPlanningState = {
  kind: BacklogPlanningStateKind;
  blockingReasons: BacklogPlanningBlockingReason[];
};

export type BacklogPlanningTask = {
  taskType?: Task["taskType"] | string | null;
  approvalStatus?: Task["approvalStatus"] | string | null;
  status?: string | null;
  assigneeId?: string | null;
  assignee?: string | null;
  ownerId?: string | null;
  owner?: string | null;
  packageId?: string | null;
  hasInitiative?: boolean;
  sprintId?: string | null;
};

export type BacklogSprintTarget = Pick<Sprint, "id" | "scoreLocked"> | null;
export type BacklogSprintAssignmentAction = "assign" | "reassign" | "unassign" | "noop";
export type BacklogSprintAssignmentReason = BacklogPlanningBlockingReason
  | "permission"
  | "target_locked"
  | "source_locked"
  | "completed"
  | "unsupported"
  | "already_assigned"
  | "already_unassigned";

export type BacklogSprintAssignmentEligibility = {
  ok: boolean;
  action: BacklogSprintAssignmentAction;
  planningState: BacklogPlanningState;
  reason?: BacklogSprintAssignmentReason;
};

export type BacklogSprintAssignmentEligibilityOptions = {
  canManage?: boolean;
  sourceSprintLocked?: boolean;
};

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

export function hasBacklogTaskOwner(task: BacklogPlanningTask) {
  return hasText(task.assigneeId) || hasText(task.ownerId) || hasText(task.assignee) || hasText(task.owner);
}

export function hasBacklogTaskInitiative(task: BacklogPlanningTask) {
  return task.hasInitiative ?? hasText(task.packageId);
}

export function getBacklogPlanningState(task: BacklogPlanningTask): BacklogPlanningState {
  if (task.taskType !== "deliverable") return { kind: "unsupported", blockingReasons: [] };
  if (normalizeStatus(task.status || "") === "Erledigt") return { kind: "completed", blockingReasons: [] };

  const blockingReasons: BacklogPlanningBlockingReason[] = [];
  if (task.approvalStatus !== "approved") blockingReasons.push("approval");
  if (!hasBacklogTaskOwner(task)) blockingReasons.push("owner");
  if (!hasBacklogTaskInitiative(task)) blockingReasons.push("initiative");
  if (blockingReasons.length) return { kind: "blocked", blockingReasons };

  return hasText(task.sprintId)
    ? { kind: "scheduled", blockingReasons: [] }
    : { kind: "ready", blockingReasons: [] };
}

export function isBacklogReadyForSprint(task: BacklogPlanningTask) {
  return getBacklogPlanningState(task).kind === "ready";
}

export function getBacklogSprintAssignmentEligibility(
  task: BacklogPlanningTask,
  targetSprint: BacklogSprintTarget,
  options: BacklogSprintAssignmentEligibilityOptions = {},
): BacklogSprintAssignmentEligibility {
  const planningState = getBacklogPlanningState(task);
  const currentSprintId = task.sprintId || "";

  if (options.canManage === false) {
    return { ok: false, action: "noop", planningState, reason: "permission" };
  }
  if (planningState.kind === "unsupported") {
    return { ok: false, action: "noop", planningState, reason: "unsupported" };
  }
  if (planningState.kind === "completed") {
    return { ok: false, action: "noop", planningState, reason: "completed" };
  }
  if (planningState.kind === "blocked") {
    return { ok: false, action: "noop", planningState, reason: planningState.blockingReasons[0] };
  }
  if (targetSprint && planningState.kind === "scheduled" && targetSprint.id === currentSprintId) {
    return { ok: true, action: "noop", planningState, reason: "already_assigned" };
  }
  if (targetSprint?.scoreLocked) {
    return { ok: false, action: "noop", planningState, reason: "target_locked" };
  }
  if (planningState.kind === "scheduled" && options.sourceSprintLocked) {
    return { ok: false, action: "noop", planningState, reason: "source_locked" };
  }
  if (!targetSprint) {
    return planningState.kind === "scheduled"
      ? { ok: true, action: "unassign", planningState }
      : { ok: true, action: "noop", planningState, reason: "already_unassigned" };
  }
  return planningState.kind === "scheduled"
    ? { ok: true, action: "reassign", planningState }
    : { ok: true, action: "assign", planningState };
}

export function backlogPlanningStateLabel(state: BacklogPlanningState) {
  if (state.kind === "ready") return "Bereit";
  if (state.kind === "scheduled") return "Eingeplant";
  if (state.kind === "completed") return "Erledigt";
  if (state.kind === "unsupported") return "Nicht einplanbar";
  const labels: Record<BacklogPlanningBlockingReason, string> = {
    approval: "Freigabe fehlt",
    owner: "Zuständigkeit fehlt",
    initiative: "Initiative fehlt",
  };
  return state.blockingReasons.map((reason) => labels[reason]).join(", ");
}

export function backlogSprintAssignmentMessage(reason?: BacklogSprintAssignmentReason) {
  const messages: Record<BacklogSprintAssignmentReason, string> = {
    permission: "Nur CEO oder Deputy können Aufgaben einem Sprint zuordnen.",
    approval: "Nur freigegebene Deliverables können einem Sprint zugeordnet werden.",
    owner: "Für die Sprint-Zuordnung fehlt die Zuständigkeit.",
    initiative: "Für die Sprint-Zuordnung fehlt die Initiative.",
    target_locked: "Gelockte Sprints können nicht mehr zugewiesen werden.",
    source_locked: "Aufgaben aus einem gelockten Sprint können nicht umgeplant werden.",
    completed: "Erledigte Aufgaben können nicht mehr einem Sprint zugeordnet werden.",
    unsupported: "Nur Deliverables können einem Sprint zugeordnet werden.",
    already_assigned: "Aufgabe ist diesem Sprint bereits zugeordnet.",
    already_unassigned: "Aufgabe ist keinem Sprint zugeordnet.",
  };
  return reason ? messages[reason] : "Sprint-Zuordnung konnte nicht geändert werden.";
}
