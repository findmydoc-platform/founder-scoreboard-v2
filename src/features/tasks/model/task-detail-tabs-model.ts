export const taskDetailTabOrder = ["overview", "subIssues", "relationships", "activity"] as const;

export type TaskDetailTabId = (typeof taskDetailTabOrder)[number];

export type TaskDetailTabAvailability = {
  activityCount: number;
  activityKnown: boolean;
  canAddRelationship: boolean;
  canComment: boolean;
  canCreateSubIssue: boolean;
  relationshipCount: number;
  relationshipsKnown: boolean;
  subIssueCount: number;
};

export function taskDetailAvailableTabs({
  activityCount,
  activityKnown,
  canAddRelationship,
  canComment,
  canCreateSubIssue,
  relationshipCount,
  relationshipsKnown,
  subIssueCount,
}: TaskDetailTabAvailability): TaskDetailTabId[] {
  const tabs: TaskDetailTabId[] = ["overview"];

  if (subIssueCount > 0 || canCreateSubIssue) tabs.push("subIssues");
  if (!relationshipsKnown || relationshipCount > 0 || canAddRelationship) tabs.push("relationships");
  if (!activityKnown || activityCount > 0 || canComment) tabs.push("activity");

  return tabs;
}

export function normalizeTaskDetailTabs(tabs?: readonly TaskDetailTabId[]): TaskDetailTabId[] {
  if (!tabs) return [...taskDetailTabOrder];
  const requested = new Set<TaskDetailTabId>(["overview", ...tabs]);
  return taskDetailTabOrder.filter((tab) => requested.has(tab));
}

export function resolveTaskDetailTab(
  value: TaskDetailTabId,
  availableTabs: readonly TaskDetailTabId[],
): TaskDetailTabId {
  return availableTabs.includes(value) ? value : "overview";
}
