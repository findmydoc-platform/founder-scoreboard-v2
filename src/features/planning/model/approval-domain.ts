import type { ApprovalDecisionAction, ApprovalStatus, PlanningShellState, Profile, Task } from "@/lib/types";

type ApprovalSubject = {
  approvalStatus: ApprovalStatus | null;
  approvalRevision: number;
  decisionNote?: string;
};

export function approvalStatusForAction(action: ApprovalDecisionAction): ApprovalStatus {
  return action === "approve" ? "approved" : action === "reject" ? "rejected" : "draft";
}

export function applyOptimisticApprovalDecision<T extends ApprovalSubject>(item: T, action: ApprovalDecisionAction, note = ""): T {
  if (item.approvalStatus === null) return item;
  return {
    ...item,
    approvalStatus: approvalStatusForAction(action),
    approvalRevision: item.approvalRevision + 1,
    decisionNote: note,
  };
}

export function applyOptimisticDeliverableApprovalDecision(task: Task, action: ApprovalDecisionAction, note = "") {
  const updated = applyOptimisticApprovalDecision(task, action, note);
  return updated.approvalStatus === "approved"
    ? updated
    : { ...updated, sprintId: "", scoreRelevant: false };
}

export function applyPlanningItemApprovalPatch(
  data: PlanningShellState,
  itemPatch: Partial<Task> & Pick<Task, "id" | "approvalStatus">,
): PlanningShellState {
  const parentType = itemPatch.taskType || data.tasks.find(task => task.id === itemPatch.id)?.taskType;
  const childType = parentType === "initiative" ? "deliverable" : parentType === "deliverable" ? "sub_issue" : null;
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id === itemPatch.id) return { ...task, ...itemPatch };
      if (task.taskType === childType && task.parentTaskId === itemPatch.id) {
        return { ...task, parentApprovalStatus: itemPatch.approvalStatus };
      }
      return task;
    }),
  };
}

export function isProposedDeliverable(task: Pick<Task, "taskType" | "approvalStatus">) {
  return task.taskType === "deliverable" && task.approvalStatus === "proposed";
}

export function isApprovedDeliverable(task: Pick<Task, "taskType" | "approvalStatus">) {
  return task.taskType === "deliverable" && task.approvalStatus === "approved";
}

export function isTaskPlanningActive(task: Pick<Task, "taskType" | "approvalStatus" | "parentApprovalStatus">) {
  return task.taskType === "deliverable"
    ? task.approvalStatus === "approved"
    : task.parentApprovalStatus === "approved";
}

export function canDecideInitiativeApproval(initiative: { approvalStatus: ApprovalStatus | null }, profile?: Pick<Profile, "platformRole"> | null) {
  return initiative.approvalStatus === "proposed"
    && (profile?.platformRole === "ceo" || profile?.platformRole === "deputy");
}

export function canReturnInitiativeForRevision(
  initiative: { approvalStatus: ApprovalStatus | null },
  profile?: Pick<Profile, "platformRole"> | null,
) {
  return initiative.approvalStatus === "proposed"
    && (profile?.platformRole === "ceo" || profile?.platformRole === "deputy");
}

type RaciOwnedInitiative = {
  ownerId?: string;
  raciAssignments?: Task["raciAssignments"];
  accountableProfileId?: string;
};
type DeliverableApprovalInitiative = RaciOwnedInitiative & { approvalStatus: ApprovalStatus | null };

function accountableProfileId(initiative?: RaciOwnedInitiative) {
  return initiative?.raciAssignments?.find((assignment) => assignment.role === "accountable")?.profileId || initiative?.accountableProfileId || initiative?.ownerId;
}

function canDecideProposedDeliverable(
  task: Pick<Task, "taskType" | "approvalStatus">,
  initiative: DeliverableApprovalInitiative | undefined,
  profile?: Pick<Profile, "id" | "platformRole"> | null,
) {
  return isProposedDeliverable(task)
    && Boolean(initiative)
    && (profile?.platformRole === "ceo" || profile?.platformRole === "deputy" || accountableProfileId(initiative) === profile?.id);
}

export function canApproveDeliverableApproval(
  task: Pick<Task, "taskType" | "approvalStatus">,
  initiative: DeliverableApprovalInitiative | undefined,
  profile?: Pick<Profile, "id" | "platformRole"> | null,
) {
  return initiative?.approvalStatus === "approved"
    && canDecideProposedDeliverable(task, initiative, profile);
}

export function canRejectDeliverableApproval(
  task: Pick<Task, "taskType" | "approvalStatus">,
  initiative: DeliverableApprovalInitiative | undefined,
  profile?: Pick<Profile, "id" | "platformRole"> | null,
) {
  return canDecideProposedDeliverable(task, initiative, profile);
}

export function canReturnDeliverableForRevision(
  task: Pick<Task, "taskType" | "approvalStatus">,
  initiative: RaciOwnedInitiative | undefined,
  profile?: Pick<Profile, "id" | "platformRole"> | null,
) {
  return task.taskType === "deliverable"
    && task.approvalStatus === "proposed"
    && (profile?.platformRole === "ceo" || profile?.platformRole === "deputy" || accountableProfileId(initiative) === profile?.id);
}

export function currentApprovalDecisionReason(
  item: Pick<ApprovalSubject, "approvalStatus" | "decisionNote">,
) {
  return item.decisionNote && (item.approvalStatus === "draft" || item.approvalStatus === "rejected")
    ? item.decisionNote
    : "";
}
