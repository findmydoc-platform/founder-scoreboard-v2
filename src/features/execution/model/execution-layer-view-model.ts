import { hasOpenWaitingRelation, isOperationalLeadRole, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile, Task, TaskFocusItem } from "@/lib/types";

export type HygieneAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: "focus" | "quality" | "blocker" | "review" | "evidence" | "dependency" | "decision" | "sync";
  title: string;
  description: string;
  recommendedAction: string;
  taskId?: string;
  decisionId?: number;
  focusStatus?: TaskFocusItem["status"];
};

export type HygieneAlertSeverityFilter = "all" | HygieneAlert["severity"];
export type HygieneAlertAreaFilter = "all" | HygieneAlert["area"];

function isOpenReviewTask(task: Task) {
  return !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
}

export function currentIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysIso(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

export function decisionStatusLabel(status: "draft" | "open_for_confirmation" | "locked") {
  if (status === "locked") return "Gelockt";
  if (status === "open_for_confirmation") return "Zur Bestätigung offen";
  return "Entwurf";
}

function priorityScore(value: string) {
  return ({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }[value as "P0"] ?? 5);
}

export function buildExecutionLayerViewModel({
  data,
  currentProfile,
  focusItems,
  hygieneAlerts,
  alertSeverityFilter,
  alertAreaFilter,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  focusItems: TaskFocusItem[];
  hygieneAlerts: HygieneAlert[];
  alertSeverityFilter: HygieneAlertSeverityFilter;
  alertAreaFilter: HygieneAlertAreaFilter;
}) {
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const isOperationalLead = isOperationalLeadRole(currentProfile?.platformRole);
  const executionTasks = isOperationalLead
    ? data.tasks
    : data.tasks.filter((task) => taskBelongsToProfile(task, currentProfile));
  const executionTaskIds = new Set(executionTasks.map((task) => task.id));
  const openTasks = executionTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
  const focusStatusCounts = focusItems.reduce<Record<TaskFocusItem["status"], number>>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { planned: 0, done: 0, blocked: 0, deferred: 0, needs_decision: 0 });
  const endOfDayOpenItems = focusItems.filter((item) => item.status === "planned");
  const endOfDayResolvedItems = focusItems.filter((item) => item.status !== "planned");
  const endOfDayCompletion = focusItems.length ? Math.round((endOfDayResolvedItems.length / focusItems.length) * 100) : 0;
  const today = currentIsoDate();
  const weekStart = addDaysIso(today, -6);
  const todayTeamFocusItems = data.taskFocusItems
    .filter((item) => item.focusDate === today && (isOperationalLead || item.profileId === currentProfile?.id))
    .sort((left, right) => left.position - right.position);
  const focusHistoryByDate = data.taskFocusItems
    .filter((item) => item.focusDate >= weekStart && item.focusDate <= today && (isOperationalLead || item.profileId === currentProfile?.id))
    .reduce<Record<string, TaskFocusItem[]>>((groups, item) => {
      groups[item.focusDate] = [...(groups[item.focusDate] || []), item];
      return groups;
    }, {});
  const focusHistoryDates = Object.keys(focusHistoryByDate).sort((left, right) => right.localeCompare(left)).slice(0, 7);
  const teamFocusCoverage = isOperationalLead && data.profiles.length
    ? Math.round((new Set(todayTeamFocusItems.map((item) => item.profileId)).size / data.profiles.length) * 100)
    : 0;
  const executionMetrics = {
    criticalAlerts: hygieneAlerts.filter((alert) => alert.severity === "critical" && (isOperationalLead || !alert.taskId || executionTaskIds.has(alert.taskId))).length,
    reviewQueue: executionTasks.filter(isOpenReviewTask).length,
    openBlockers: executionTasks.filter((task) => normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)).length,
    decisionsWithoutTasks: data.decisions.filter((decision) => decision.status === "locked" && !data.decisionTaskLinks.some((link) => link.decisionId === decision.id)).length,
  };
  const openReviewTasks = data.tasks
    .filter(isOpenReviewTask)
    .sort((left, right) => (left.reviewRequestedAt || "").localeCompare(right.reviewRequestedAt || "") || priorityScore(left.priority) - priorityScore(right.priority));
  const myReviewTasks = openReviewTasks.filter((task) => task.reviewOwnerProfileId === currentProfile?.id);
  const teamReviewTasks = isOperationalLead ? openReviewTasks : myReviewTasks;
  const reviewTasksWithoutOwner = teamReviewTasks.filter((task) => !task.reviewOwnerProfileId);
  const overdueReviewTasks = teamReviewTasks.filter((task) => task.reviewRequestedAt && task.reviewRequestedAt.slice(0, 10) < addDaysIso(today, -2));
  const suggestedTasks = [...openTasks]
    .sort((left, right) => {
      const leftBlocked = hasOpenWaitingRelation(left.id, data.tasks, data.taskRelations) ? -1 : 0;
      const rightBlocked = hasOpenWaitingRelation(right.id, data.tasks, data.taskRelations) ? -1 : 0;
      return priorityScore(left.priority) - priorityScore(right.priority) || leftBlocked - rightBlocked || (left.endDate || "").localeCompare(right.endDate || "");
    })
    .slice(0, 6);
  const filteredAlerts = hygieneAlerts.filter((alert) =>
    (isOperationalLead || Boolean(alert.taskId && executionTaskIds.has(alert.taskId)))
    && (alertSeverityFilter === "all" || alert.severity === alertSeverityFilter)
    && (alertAreaFilter === "all" || alert.area === alertAreaFilter),
  );
  const visibleAlerts = filteredAlerts.slice(0, 12);
  const visibleProfiles = isOperationalLead
    ? data.profiles
    : data.profiles.filter((profile) => profile.id === currentProfile?.id);

  return {
    taskById,
    isOperationalLead,
    executionTasks,
    executionTaskIds,
    openTasks,
    focusStatusCounts,
    endOfDayOpenItems,
    endOfDayCompletion,
    todayTeamFocusItems,
    focusHistoryByDate,
    focusHistoryDates,
    teamFocusCoverage,
    executionMetrics,
    myReviewTasks,
    teamReviewTasks,
    reviewTasksWithoutOwner,
    overdueReviewTasks,
    suggestedTasks,
    filteredAlerts,
    visibleAlerts,
    visibleProfiles,
  };
}
