import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import { appWorkspaceFromValue, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningShellState, PlanningFilterPreferences, Profile, ViewMode } from "@/lib/types";

export type ProfileSettingsSectionId = "profile" | "notifications" | "board" | "process" | "api";

export type ProfileSettingsDraft = {
  focus: string;
  color: string;
  notificationsEnabled: boolean;
  notificationEvents: Record<string, boolean>;
  defaultWorkspace: AppWorkspace;
  defaultTaskView: ViewMode;
  planningFilters: PlanningFilterPreferences;
  expandedInitiativeIds: string[];
};

function eventEnabled(data: PlanningShellState, profileId: string, eventType: string) {
  const preference = data.notificationPreferences.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
  return preference?.enabled !== false;
}

export function defaultFilters(filters: Partial<PlanningFilterPreferences> = {}): PlanningFilterPreferences {
  return {
    query: filters.query || "",
    assignee: filters.assignee || "Alle",
    status: filters.status || "Alle",
    priority: filters.priority || "Alle",
    review: filters.review || "Alle",
    initiativeId: filters.initiativeId || "Alle",
    quick: filters.quick || [],
    sprintId: filters.sprintId || "Alle",
    workstream: filters.workstream || "Alle",
    risk: filters.risk || "Alle",
    targetFrom: filters.targetFrom || "",
    targetTo: filters.targetTo || "",
    sort: filters.sort || "priority",
    direction: filters.direction === "desc" ? "desc" : "asc",
  };
}

function normalizedDefaultWorkspace(value: string) {
  return appWorkspaceFromValue(value) || "planning";
}

export function buildInitialDraft({
  currentProfile,
  data,
  profileUiPreference,
}: {
  currentProfile: Profile;
  data: PlanningShellState;
  profileUiPreference: NonNullable<PlanningShellState["profileUiPreferences"][number]> | null;
}): ProfileSettingsDraft {
  return {
    focus: currentProfile.focus || "",
    color: currentProfile.color || "#64748b",
    notificationsEnabled: currentProfile.notificationsEnabled !== false,
    notificationEvents: Object.fromEntries(googleChatDigestEventTypes.map((eventType) => [eventType, eventEnabled(data, currentProfile.id, eventType)])),
    defaultWorkspace: profileUiPreference?.defaultWorkspace ? normalizedDefaultWorkspace(profileUiPreference.defaultWorkspace) : "planning",
    defaultTaskView: profileUiPreference?.defaultTaskView || "board",
    planningFilters: defaultFilters(profileUiPreference?.planningFilters),
    expandedInitiativeIds: profileUiPreference?.expandedInitiativeIds || [],
  };
}

export function serializeDraft(draft: ProfileSettingsDraft) {
  return JSON.stringify({
    ...draft,
    expandedInitiativeIds: [...draft.expandedInitiativeIds].sort(),
    notificationEvents: Object.fromEntries(Object.entries(draft.notificationEvents).sort(([left], [right]) => left.localeCompare(right))),
  });
}
