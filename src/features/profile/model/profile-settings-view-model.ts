import { googleChatDigestEventTypes } from "@/lib/notification-policy";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { PlanningData, PlanningFilterPreferences, Profile, ViewMode } from "@/lib/types";

export type ProfileSettingsSectionId = "profile" | "notifications" | "board";

export type ProfileSettingsDraft = {
  focus: string;
  color: string;
  notificationsEnabled: boolean;
  notificationEvents: Record<string, boolean>;
  defaultWorkspace: AppWorkspace;
  defaultTaskView: ViewMode;
  planningFilters: PlanningFilterPreferences;
  expandedPackageIds: string[];
};

export const profileColorOptions = [
  { value: "#22c55e", label: "Mint" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#f59e0b", label: "Gelb" },
  { value: "#8b5cf6", label: "Lila" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Türkis" },
  { value: "#ef4444", label: "Rot" },
  { value: "#64748b", label: "Schiefer" },
];

function eventEnabled(data: PlanningData, profileId: string, eventType: string) {
  const preference = data.notificationPreferences.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
  return preference?.enabled !== false;
}

export function expandedPackageIds(expandedPackages: Record<string, boolean>) {
  return Object.entries(expandedPackages)
    .filter(([, expanded]) => expanded)
    .map(([packageId]) => packageId);
}

export function defaultFilters(filters: PlanningFilterPreferences): PlanningFilterPreferences {
  return {
    query: filters.query || "",
    assignee: filters.assignee || "Alle",
    status: filters.status || "Alle",
    priority: filters.priority || "Alle",
    packageId: filters.packageId || "Alle",
    quick: filters.quick || "",
  };
}

function normalizedDefaultWorkspace(value: string) {
  return value === "mine" || value === "execution" ? "planning" : value as AppWorkspace;
}

export function buildInitialDraft({
  currentProfile,
  data,
  expandedPackages,
  filters,
  profileUiPreference,
  view,
  workspace,
}: {
  currentProfile: Profile;
  data: PlanningData;
  expandedPackages: Record<string, boolean>;
  filters: PlanningFilterPreferences;
  profileUiPreference: NonNullable<PlanningData["profileUiPreferences"][number]> | null;
  view: ViewMode;
  workspace: AppWorkspace;
}): ProfileSettingsDraft {
  return {
    focus: currentProfile.focus || "",
    color: currentProfile.color || "#64748b",
    notificationsEnabled: currentProfile.notificationsEnabled !== false,
    notificationEvents: Object.fromEntries(googleChatDigestEventTypes.map((eventType) => [eventType, eventEnabled(data, currentProfile.id, eventType)])),
    defaultWorkspace: profileUiPreference?.defaultWorkspace ? normalizedDefaultWorkspace(profileUiPreference.defaultWorkspace) : (workspace === "profile" ? "planning" : workspace),
    defaultTaskView: profileUiPreference?.defaultTaskView || view,
    planningFilters: defaultFilters(profileUiPreference?.planningFilters || filters),
    expandedPackageIds: profileUiPreference?.expandedPackageIds || expandedPackageIds(expandedPackages),
  };
}

export function serializeDraft(draft: ProfileSettingsDraft) {
  return JSON.stringify({
    ...draft,
    expandedPackageIds: [...draft.expandedPackageIds].sort(),
    notificationEvents: Object.fromEntries(Object.entries(draft.notificationEvents).sort(([left], [right]) => left.localeCompare(right))),
  });
}
