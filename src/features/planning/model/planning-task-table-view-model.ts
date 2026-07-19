import { isThisWeek, sortTasks, taskText } from "@/features/planning/model/planning-app-model";
import { taskHasCriticalAttention, taskHasMissingEvidenceAttention } from "@/features/tasks/model/task-attention-signals";
import { hasGitHubIssue, hasOpenWaitingRelation, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, PlanningFilterPreferences, Profile } from "@/lib/types";

export function buildPlanningTaskTableViewModel({
  currentProfile,
  data,
  filters,
}: {
  currentProfile: Profile | null;
  data: PlanningData;
  filters: PlanningFilterPreferences;
}) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("de");
  const visibleTasks = sortTasks(data.tasks.filter((task) => {
    if (task.taskType === "sub_issue") return false;
    const normalized = normalizeStatus(task.status);
    const initiative = data.packages.find((pack) => pack.id === task.packageId);
    const sprint = data.sprints.find((item) => item.id === task.sprintId);
    const reviewOwner = data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId);
    const matchesQuery = !normalizedQuery || [
      taskText(task),
      normalized,
      initiative?.title || "",
      initiative?.goal || "",
      sprint?.name || "",
      reviewOwner?.name || "",
    ].join(" ").toLocaleLowerCase("de").includes(normalizedQuery);
    const matchesAssignee = filters.assignee === "Alle" || task.assignee === filters.assignee || task.assigneeId === filters.assignee;
    const matchesStatus = filters.status === "Alle" || normalized === filters.status;
    const matchesPriority = filters.priority === "Alle" || task.priority === filters.priority;
    const matchesReview = !filters.review || filters.review === "Alle" || task.reviewStatus === filters.review;
    const matchesPackage = filters.packageId === "Alle" || task.packageId === filters.packageId;
    const matchesSprint = filters.sprintId === "Alle" || task.sprintId === filters.sprintId;
    const matchesWorkstream = filters.workstream === "Alle" || task.workstream === filters.workstream;
    const deadline = task.deadline || task.endDate || "";
    const matchesTargetFrom = !filters.targetFrom || deadline >= filters.targetFrom;
    const matchesTargetTo = !filters.targetTo || deadline <= filters.targetTo;
    const matchesRisk = filters.risk === "Alle"
      || filters.risk === "critical" && taskHasCriticalAttention(task, data)
      || filters.risk === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn) || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations))
      || filters.risk === "evidence" && taskHasMissingEvidenceAttention(task)
      || filters.risk === "github" && !hasGitHubIssue(task);
    const matchesQuick = !filters.quick.length || filters.quick.some((quickFilter) => (
      quickFilter === "mine" && taskBelongsToProfile(task, currentProfile)
      || quickFilter === "my-reviews" && task.reviewStatus === "requested" && !task.scoreFinal && Boolean(currentProfile?.id) && task.reviewOwnerProfileId === currentProfile?.id
      || quickFilter === "open" && normalized === "Offen"
      || quickFilter === "critical" && taskHasCriticalAttention(task, data)
      || quickFilter === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn) || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations))
      || quickFilter === "week" && isThisWeek(task)
      || quickFilter === "high" && ["P0", "P1"].includes(task.priority)
      || quickFilter === "evidence" && taskHasMissingEvidenceAttention(task)
    ));

    return matchesQuery && matchesAssignee && matchesStatus && matchesPriority && matchesReview && matchesPackage
      && matchesSprint && matchesWorkstream && matchesTargetFrom && matchesTargetTo && matchesRisk && matchesQuick;
  }));

  return {
    visibleTasks,
    metrics: {
      total: visibleTasks.length,
      open: visibleTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt").length,
      blocked: visibleTasks.filter((task) => task.dependsOn || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations) || normalizeStatus(task.status) === "Blockiert").length,
      done: visibleTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length,
    },
  };
}
