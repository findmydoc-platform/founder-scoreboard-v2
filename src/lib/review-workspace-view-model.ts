import { hasOpenWaitingRelation, isOperationalLeadRole } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile, Task } from "@/lib/types";

export type ReviewStatusFilter = "open" | "completed" | "rework" | "blocked" | "all";
export type ReviewOwnerFilter = "mine" | "all" | string;

export type ReviewWorkspaceFilters = {
  status: ReviewStatusFilter;
  owner: ReviewOwnerFilter;
};

export const reviewStatusFilterOptions: Array<{ value: ReviewStatusFilter; label: string }> = [
  { value: "open", label: "Offen" },
  { value: "completed", label: "Abgeschlossen" },
  { value: "rework", label: "Nacharbeit" },
  { value: "blocked", label: "Geblockt" },
  { value: "all", label: "Alle" },
];

function priorityScore(value: string) {
  return ({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }[value as "P0"] ?? 9);
}

export function isOpenReviewTask(task: Task) {
  return !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
}

export function isCompletedReviewTask(task: Task) {
  return task.scoreFinal || task.reviewStatus === "accepted" || task.reviewStatus === "partial";
}

export function isReworkReviewTask(task: Task) {
  return normalizeStatus(task.status) === "Nacharbeit" || task.reviewStatus === "changes_requested";
}

export function isBlockedReviewTask(task: Task, data: Pick<PlanningData, "tasks" | "taskRelations">) {
  return normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations);
}

export function isReviewRelevantTask(task: Task, data: Pick<PlanningData, "tasks" | "taskRelations">) {
  return isOpenReviewTask(task) || isCompletedReviewTask(task) || isReworkReviewTask(task) || isBlockedReviewTask(task, data);
}

export function canActOnReview(task: Task, profile: Profile | null) {
  if (!profile) return false;
  return isOperationalLeadRole(profile.platformRole) || task.reviewOwnerProfileId === profile.id;
}

function taskMatchesStatus(task: Task, data: PlanningData, status: ReviewStatusFilter) {
  if (status === "all") return true;
  if (status === "open") return isOpenReviewTask(task);
  if (status === "completed") return isCompletedReviewTask(task);
  if (status === "rework") return isReworkReviewTask(task);
  return isBlockedReviewTask(task, data);
}

function taskMatchesOwner(task: Task, owner: ReviewOwnerFilter, currentProfile: Profile | null) {
  if (owner === "all") return true;
  if (owner === "mine") return Boolean(currentProfile && task.reviewOwnerProfileId === currentProfile.id);
  return task.reviewOwnerProfileId === owner;
}

export function buildReviewWorkspaceViewModel({
  data,
  currentProfile,
  filters,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  filters: ReviewWorkspaceFilters;
}) {
  const reviewTasks = data.tasks.filter((task) => isReviewRelevantTask(task, data));
  const visibleTasks = reviewTasks
    .filter((task) => taskMatchesStatus(task, data, filters.status))
    .filter((task) => taskMatchesOwner(task, filters.owner, currentProfile))
    .sort((left, right) => {
      const leftOpen = isOpenReviewTask(left) ? 0 : 1;
      const rightOpen = isOpenReviewTask(right) ? 0 : 1;
      return leftOpen - rightOpen
        || priorityScore(left.priority) - priorityScore(right.priority)
        || (left.reviewRequestedAt || "").localeCompare(right.reviewRequestedAt || "")
        || left.order - right.order;
    });
  const ownerOptions = [
    { value: "mine", label: "Meine" },
    { value: "all", label: "Alle" },
    ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];

  return {
    reviewTasks,
    visibleTasks,
    ownerOptions,
    metrics: {
      open: reviewTasks.filter(isOpenReviewTask).length,
      completed: reviewTasks.filter(isCompletedReviewTask).length,
      rework: reviewTasks.filter(isReworkReviewTask).length,
      blocked: reviewTasks.filter((task) => isBlockedReviewTask(task, data)).length,
    },
  };
}
