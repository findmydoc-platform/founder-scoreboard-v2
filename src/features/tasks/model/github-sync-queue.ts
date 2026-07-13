import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

export function taskNeedsGitHubSync(task: Task, openCommentTaskIds: Set<string>) {
  return !hasGitHubIssue(task) || task.githubIssueSyncStatus !== "synced" || openCommentTaskIds.has(task.id);
}

export function isGitHubSyncEligible(task: Task) {
  return task.taskType === "deliverable"
    ? task.approvalStatus === "approved"
    : task.parentApprovalStatus === "approved";
}

export function sortGitHubSyncTasks(tasks: Task[], allTasks: Task[] = tasks) {
  const taskById = new Map(allTasks.map((task) => [task.id, task]));
  return [...tasks].sort((left, right) => {
    const leftParent = left.taskType === "sub_issue" ? taskById.get(left.parentTaskId) : left;
    const rightParent = right.taskType === "sub_issue" ? taskById.get(right.parentTaskId) : right;
    const parentOrder = (leftParent?.title || left.title).localeCompare(rightParent?.title || right.title);
    if (parentOrder) return parentOrder;
    const typeOrder = Number(left.taskType === "sub_issue") - Number(right.taskType === "sub_issue");
    if (typeOrder) return typeOrder;
    return left.title.localeCompare(right.title);
  });
}

export function githubBulkSyncTasks({
  tasks,
  openCommentTaskIds,
  failedCommentTaskIds,
  onlyFailed = false,
}: {
  tasks: Task[];
  openCommentTaskIds: Set<string>;
  failedCommentTaskIds: Set<string>;
  onlyFailed?: boolean;
}) {
  const failedTaskIds = new Set(tasks
    .filter((task) => task.githubIssueSyncStatus === "failed" || failedCommentTaskIds.has(task.id))
    .map((task) => task.id));

  const selected = tasks.filter((task) => {
    if (!isGitHubSyncEligible(task) || !taskNeedsGitHubSync(task, openCommentTaskIds)) return false;
    if (!onlyFailed) return true;
    return failedTaskIds.has(task.id) || (task.taskType === "sub_issue" && failedTaskIds.has(task.parentTaskId));
  });

  return sortGitHubSyncTasks(selected, tasks);
}
