export const taskDetailTabOrder = ["overview", "relationships", "activity"] as const;

export type TaskDetailTabId = (typeof taskDetailTabOrder)[number];

export type TaskDetailTabAvailability = {
  activityCount: number;
  activityKnown: boolean;
  canAddRelationship: boolean;
  canComment: boolean;
  relationshipCount: number;
  relationshipsKnown: boolean;
};

export function taskDetailAvailableTabs({
  activityCount,
  activityKnown,
  canAddRelationship,
  canComment,
  relationshipCount,
  relationshipsKnown,
}: TaskDetailTabAvailability): TaskDetailTabId[] {
  const tabs: TaskDetailTabId[] = ["overview"];

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
