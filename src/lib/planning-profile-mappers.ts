import type { Milestone, Package, PlanningFilterPreferences, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ViewMode } from "./types";
import type { DbMilestone, DbPackage, DbProfile, DbProfileFeatureTourAcknowledgement, DbProfileUiPreference } from "./planning-data-row-types";

const fallbackProfileColors: Record<string, string> = {
  volkan: "#22c55e",
  sebastian: "#3b82f6",
  anil: "#f59e0b",
  ozen: "#8b5cf6",
  youssef: "#ec4899",
};

function profileColor(id: string, value?: string | null) {
  return value || fallbackProfileColors[id] || "#64748b";
}

const defaultPlanningFilters: PlanningFilterPreferences = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  packageId: "Alle",
  quick: [],
};

function filterString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function filterStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value ? [value] : [];
}

function mapPlanningFilters(value: unknown): PlanningFilterPreferences {
  if (!value || typeof value !== "object") return defaultPlanningFilters;
  const candidate = value as Partial<Record<keyof PlanningFilterPreferences, unknown>> & { owner?: unknown };
  return {
    query: filterString(candidate.query, defaultPlanningFilters.query),
    assignee: filterString(candidate.assignee, filterString(candidate.owner, defaultPlanningFilters.assignee)),
    status: filterString(candidate.status, defaultPlanningFilters.status),
    priority: filterString(candidate.priority, defaultPlanningFilters.priority),
    packageId: filterString(candidate.packageId, defaultPlanningFilters.packageId),
    quick: filterStringArray(candidate.quick),
  };
}

function mapViewMode(value: unknown): ViewMode {
  return value === "structure" || value === "table" || value === "gantt" ? value : "board";
}

export function mapProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    platformRole: row.platform_role || (row.role === "admin" ? "ceo" : "founder"),
    orgRole: row.org_role || (row.role === "admin" ? "CEO" : "Founder"),
    githubLogin: row.github_login || "",
    deputyFor: row.deputy_for || "",
    deputyActiveFrom: row.deputy_active_from || "",
    deputyActiveUntil: row.deputy_active_until || "",
    focus: row.focus || "",
    weeklyCapacity: row.weekly_capacity,
    color: profileColor(row.id, row.profile_color),
    googleChatUserId: row.google_chat_user_id || "",
    googleChatDmSpace: row.google_chat_dm_space || "",
    notificationsEnabled: row.notifications_enabled !== false,
  };
}

export function mapProfileUiPreference(row: DbProfileUiPreference): ProfileUiPreference {
  return {
    profileId: row.profile_id,
    defaultWorkspace: row.default_workspace || "planning",
    defaultTaskView: mapViewMode(row.default_task_view),
    planningFilters: mapPlanningFilters(row.planning_filters),
    expandedPackageIds: row.expanded_package_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProfileFeatureTourAcknowledgement(row: DbProfileFeatureTourAcknowledgement): ProfileFeatureTourAcknowledgement {
  return {
    profileId: row.profile_id,
    tourId: row.tour_id,
    seenAt: row.seen_at,
  };
}

export function mapPackage(row: DbPackage): Package {
  const ownerId = row.owner_id || "";
  return {
    id: row.id,
    milestoneId: row.milestone_id || "",
    ownerId,
    accountableProfileId: row.accountable_profile_id || ownerId,
    responsibleProfileIds: row.responsible_profile_ids?.length ? row.responsible_profile_ids : ownerId ? [ownerId] : [],
    consultedProfileIds: row.consulted_profile_ids || [],
    informedProfileIds: row.informed_profile_ids || [],
    title: row.title,
    goal: row.goal || "",
    priority: row.priority || "P2",
    status: row.status || "planned",
    targetDate: row.target_date || "",
    successCriteria: row.success_criteria || "",
    scopeConstraints: row.scope_constraints || "",
    sortOrder: row.sort_order,
  };
}

export function mapMilestone(row: DbMilestone): Milestone {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    targetDate: row.target_date || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function profileNameById(profiles: Profile[], profileId?: string | null) {
  return profiles.find((profile) => profile.id === profileId)?.name || profileId || "";
}
