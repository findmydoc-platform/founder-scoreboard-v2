import { hasOpenWaitingRelation, isOperationalLeadRole } from "@/lib/platform";
import { taskHasCriticalAttention } from "@/features/tasks/model/task-attention-signals";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile, Task } from "@/lib/types";

export type ReviewStatusFilter = "open" | "completed" | "rework" | "blocked" | "all";
export type ReviewOwnerFilter = "mine" | "all" | string;
export type ReviewSort = "priority" | "title" | "assignee" | "owner" | "status" | "date";
export type ReviewRiskFilter = "all" | "blocked" | "critical";

export type ReviewWorkspaceFilters = {
  status: ReviewStatusFilter;
  owner: ReviewOwnerFilter;
  query: string;
  priority: string;
  assignee: string;
  risk: ReviewRiskFilter;
  from: string;
  to: string;
  sort: ReviewSort;
  direction: "asc" | "desc";
};

export const DEFAULT_REVIEW_FILTERS: ReviewWorkspaceFilters = {
  status: "open",
  owner: "all",
  query: "",
  priority: "Alle",
  assignee: "Alle",
  risk: "all",
  from: "",
  to: "",
  sort: "priority",
  direction: "asc",
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
  if (status === "completed") return isCompletedReviewTask(task);
  if (status === "blocked") return isBlockedReviewTask(task, data);
  if (status === "rework") return isReworkReviewTask(task);
  return isOpenReviewTask(task);
}

function reviewStatusBucket(task: Task, data: Pick<PlanningData, "tasks" | "taskRelations">): Exclude<ReviewStatusFilter, "all"> {
  if (isCompletedReviewTask(task)) return "completed";
  if (isBlockedReviewTask(task, data)) return "blocked";
  if (isReworkReviewTask(task)) return "rework";
  return "open";
}

function taskMatchesOwner(task: Task, owner: ReviewOwnerFilter, currentProfile: Profile | null) {
  if (owner === "all") return true;
  if (owner === "mine") return Boolean(currentProfile && task.reviewOwnerProfileId === currentProfile.id);
  return task.reviewOwnerProfileId === owner;
}

export function buildReviewWorkspaceViewModel({
  data,
  currentProfile,
  filters: rawFilters,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  filters: Partial<ReviewWorkspaceFilters> & Pick<ReviewWorkspaceFilters, "status" | "owner">;
}) {
  const filters = { ...DEFAULT_REVIEW_FILTERS, ...rawFilters };
  const reviewTasks = data.tasks.filter((task) => isReviewRelevantTask(task, data));
  const query = filters.query.trim().toLocaleLowerCase("de");
  const direction = filters.direction === "desc" ? -1 : 1;
  const profileName = (profileId?: string) => data.profiles.find((profile) => profile.id === profileId)?.name || profileId || "";
  const visibleTasks = reviewTasks
    .filter((task) => taskMatchesStatus(task, data, filters.status))
    .filter((task) => taskMatchesOwner(task, filters.owner, currentProfile))
    .filter((task) => filters.priority === "Alle" || task.priority === filters.priority)
    .filter((task) => filters.assignee === "Alle" || task.assigneeId === filters.assignee || task.assignee === filters.assignee)
    .filter((task) => filters.risk === "all" || filters.risk === "blocked" && isBlockedReviewTask(task, data) || filters.risk === "critical" && taskHasCriticalAttention(task, data))
    .filter((task) => !filters.from || (task.reviewRequestedAt || task.deadline || "") >= filters.from)
    .filter((task) => !filters.to || (task.reviewRequestedAt || task.deadline || "") <= filters.to)
    .filter((task) => !query || [task.title, task.description, task.assignee, profileName(task.reviewOwnerProfileId), task.priority, task.workstream].join(" ").toLocaleLowerCase("de").includes(query))
    .sort((left, right) => {
      if (filters.sort === "title") return direction * left.title.localeCompare(right.title, "de");
      if (filters.sort === "assignee") return direction * (left.assignee || "").localeCompare(right.assignee || "", "de");
      if (filters.sort === "owner") return direction * profileName(left.reviewOwnerProfileId).localeCompare(profileName(right.reviewOwnerProfileId), "de");
      if (filters.sort === "status") return direction * reviewStatusBucket(left, data).localeCompare(reviewStatusBucket(right, data), "de");
      if (filters.sort === "date") return direction * (left.reviewRequestedAt || left.deadline || "").localeCompare(right.reviewRequestedAt || right.deadline || "");
      const leftOpen = isOpenReviewTask(left) ? 0 : 1;
      const rightOpen = isOpenReviewTask(right) ? 0 : 1;
      return direction * (leftOpen - rightOpen
        || priorityScore(left.priority) - priorityScore(right.priority)
        || (left.reviewRequestedAt || "").localeCompare(right.reviewRequestedAt || "")
        || left.order - right.order);
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
      total: reviewTasks.length,
      open: reviewTasks.filter((task) => taskMatchesStatus(task, data, "open")).length,
      completed: reviewTasks.filter((task) => taskMatchesStatus(task, data, "completed")).length,
      rework: reviewTasks.filter((task) => taskMatchesStatus(task, data, "rework")).length,
      blocked: reviewTasks.filter((task) => taskMatchesStatus(task, data, "blocked")).length,
    },
  };
}
